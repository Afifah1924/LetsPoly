import type { NetFit } from "./netMeasurement";
import { computeNet, type NetResult } from "./polyhedronNetUtils";

/**
 * Printable PDF export of the 2D net — written here, byte by byte, with no PDF
 * library and no server round trip. A PDF library would be a megabyte of bundle
 * for one button; what this file needs to draw is a few hundred numbers.
 *
 * The document is a plain PDF 1.4: vector paths for the net (faces, fold
 * creases, cut lines, glue tabs), base-14 Helvetica for the captions and a
 * classic xref table, so every reader (and every print driver) can open it.
 *
 * Everything is laid out at TRUE SIZE — 1 mm of net is 1 mm of paper
 * (1 mm = 72/25.4 pt) — so a sheet can be cut and folded straight from the file.
 * A net larger than the chosen paper is tiled onto sheets of exactly that paper
 * size, each sheet showing its own window of the same drawing, so the sheets
 * butt together into one continuous, unscaled net. See `planSheets` for how the
 * window shift keeps that join exact.
 */

export type PaperSize = "A4" | "A3";
export type Unit = "mm" | "cm";

/** Paper sizes in portrait millimetres — the ISO A series the panel offers. */
export const PAPER_MM: Record<PaperSize, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
};

/** PDF user space: 1 pt = 1/72 in, so 1 mm = 72/25.4 pt = 2.8346… pt. */
export const PT_PER_MM = 72 / 25.4;

/** 1 pt in millimetres — used the other way round, to size text in mm. */
const MM_PER_PT = 25.4 / 72;

/**
 * How far the net is nudged in from the sheet's left/top edge (mm).
 *
 * The shift is the *same on every sheet*, which is what keeps the tiling exact:
 * sheet k shows net x ∈ [k·W − shift, (k+1)·W − shift], and that window still
 * ends exactly where sheet k+1's window begins. All it changes is which part of
 * the sheet the first row/column of the net lands on, so the outermost lines no
 * longer sit on the page edge where a printer's unprintable margin would clip
 * them.
 */
const SHEET_SHIFT_MM = 8;

export type SheetLayout = {
  paper: PaperSize;
  /** Sheet dimensions as used (landscape swaps the A series pair). */
  sheetWmm: number;
  sheetHmm: number;
  landscape: boolean;
  cols: number;
  rows: number;
  pages: number;
  /** Uniform offset of the net inside every sheet, in mm (see SHEET_SHIFT_MM). */
  shiftXmm: number;
  shiftYmm: number;
};

/**
 * Lay a net of `netWidthMm × netHeightMm` out over sheets of the chosen paper.
 *
 * Orientation is whichever gives fewer pages (portrait wins a tie), and the page
 * count is `cols × rows` — the same number the panel shows under "Print pages",
 * because both read it from here.
 */
export function planSheets(netWidthMm: number, netHeightMm: number, paper: PaperSize): SheetLayout {
  const { w, h } = PAPER_MM[paper];
  // The epsilon stops a net that is exactly one sheet wide (210.0000001 mm of
  // accumulated float noise, say) from claiming a second page.
  const count = (sw: number, sh: number) =>
    Math.max(1, Math.ceil(netWidthMm / sw - 1e-9)) * Math.max(1, Math.ceil(netHeightMm / sh - 1e-9));

  const landscape = count(h, w) < count(w, h);
  const sheetWmm = landscape ? h : w;
  const sheetHmm = landscape ? w : h;
  const cols = Math.max(1, Math.ceil(netWidthMm / sheetWmm - 1e-9));
  const rows = Math.max(1, Math.ceil(netHeightMm / sheetHmm - 1e-9));

  return {
    paper,
    sheetWmm,
    sheetHmm,
    landscape,
    cols,
    rows,
    pages: cols * rows,
    // Only as much shift as the tiling can spare: the last sheet must still
    // reach the net's far edge, i.e. cols·W − shift ≥ netWidth.
    shiftXmm: Math.max(0, Math.min(SHEET_SHIFT_MM, cols * sheetWmm - netWidthMm)),
    shiftYmm: Math.max(0, Math.min(SHEET_SHIFT_MM, rows * sheetHmm - netHeightMm)),
  };
}

/* ------------------------------------------------------------------ *
 * Small PDF writer
 * ------------------------------------------------------------------ */

export type Rgb = readonly [number, number, number];

type Pt = { x: number; y: number };

/** PDF numbers: two decimals is far below print resolution (0.01 pt = 3 µm). */
const num = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return (r === 0 ? 0 : r).toFixed(2);
};

/**
 * Our glyph set is ASCII only, and so is the file. A PDF text string carries
 * bytes, not Unicode, and base-14 Helvetica with WinAnsiEncoding would render a
 * UTF-8 multi-byte sequence as mojibake — so the typographic characters used
 * elsewhere in the app (× ° — ≈) are folded down to ASCII spellings here, and
 * anything else is dropped rather than written as garbage.
 */
const ASCII_FOLD: Record<string, string> = {
  "\u00d7": "x",
  "\u00b0": "deg",
  "\u2014": "-",
  "\u2013": "-",
  "\u2018": "'",
  "\u2019": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u00b7": "-",
  "\u2026": "...",
  "\u2248": "~",
  "\u2264": "<=",
  "\u2265": ">=",
  "\u00b1": "+/-",
  "\u00f7": "/",
  "\u2192": "->",
};

/** Escapes a string for a PDF literal string `( … )`, ASCII only. */
function pdfText(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, (c) => ASCII_FOLD[c] ?? "?").replace(/([\\()])/g, "\\$1");
}

/** Helvetica advance widths (1/1000 em), for the characters we actually print. */
const CHAR_WIDTH: Record<string, number> = {
  " ": 278,
  "!": 278,
  '"': 355,
  "#": 556,
  "%": 889,
  "&": 667,
  "'": 191,
  "(": 333,
  ")": 333,
  "*": 389,
  "+": 584,
  ",": 278,
  "-": 333,
  ".": 278,
  "/": 278,
  ":": 278,
  ";": 278,
  "<": 584,
  "=": 584,
  ">": 584,
  "?": 556,
  "[": 278,
  "]": 278,
  "|": 260,
};

/** Width of a string in millimetres — close enough to centre a caption line. */
export function textWidthMm(text: string, sizePt: number, bold = false): number {
  let em = 0;
  for (const ch of text) {
    if (ch >= "0" && ch <= "9") em += 556;
    else if (ch >= "A" && ch <= "Z") em += 667;
    else if (ch >= "a" && ch <= "z") em += 556;
    else em += CHAR_WIDTH[ch] ?? 556;
  }
  return ((em * sizePt) / 1000) * MM_PER_PT * (bold ? 1.05 : 1);
}

type TextOptions = {
  size?: number;
  bold?: boolean;
  color?: Rgb;
  /** Horizontal anchoring around the given x. */
  align?: "start" | "middle" | "end";
  /** Degrees, counter-clockwise, matching the tilt of the same label on screen. */
  rotate?: number;
};

const INK: Rgb = [0.12, 0.16, 0.22];
const MUTED: Rgb = [0.42, 0.47, 0.55];
const HAIRLINE: Rgb = [0.78, 0.82, 0.86];
const PAPER: Rgb = [1, 1, 1];
const FACE_FILL: Rgb = [0.94, 0.99, 0.97];
const TAB_FILL: Rgb = [0.96, 0.97, 0.99];
const CUT_LINE: Rgb = [0.04, 0.45, 0.42];
const FOLD_LINE: Rgb = [0.45, 0.51, 0.6];
const ACCENT: Rgb = [0.02, 0.65, 0.58];

/**
 * One sheet's content stream.
 *
 * Coordinates are millimetres measured from the sheet's TOP-LEFT corner, exactly
 * like the on-screen SVG — the flip into PDF space (y up from the bottom) and the
 * mm → pt conversion happen inside, so the drawing code reads the same as the
 * preview's.
 */
class SheetCanvas {
  readonly sheetWmm: number;
  readonly sheetHmm: number;
  private readonly ops: string[] = [];
  private strokeColor: Rgb | null = null;
  private fillColor: Rgb | null = null;
  private lineWidthMm = -1;
  private dashKey = "";

  constructor(sheetWmm: number, sheetHmm: number) {
    this.sheetWmm = sheetWmm;
    this.sheetHmm = sheetHmm;
  }

  /** Top-left mm → PDF pt, with y flipped. */
  private x(xMm: number): number {
    return xMm * PT_PER_MM;
  }
  private y(yMm: number): number {
    return (this.sheetHmm - yMm) * PT_PER_MM;
  }

  private useStroke(c: Rgb) {
    if (this.strokeColor?.[0] === c[0] && this.strokeColor[1] === c[1] && this.strokeColor[2] === c[2]) return;
    this.strokeColor = c;
    this.ops.push(`${num(c[0])} ${num(c[1])} ${num(c[2])} RG`);
  }
  private useFill(c: Rgb) {
    if (this.fillColor?.[0] === c[0] && this.fillColor[1] === c[1] && this.fillColor[2] === c[2]) return;
    this.fillColor = c;
    this.ops.push(`${num(c[0])} ${num(c[1])} ${num(c[2])} rg`);
  }
  private useWidth(mm: number) {
    if (this.lineWidthMm === mm) return;
    this.lineWidthMm = mm;
    this.ops.push(`${num(mm * PT_PER_MM)} w`);
  }
  private useDash(pattern: readonly [number, number] | null) {
    const key = pattern ? `${pattern[0]}/${pattern[1]}` : "";
    if (this.dashKey === key) return;
    this.dashKey = key;
    this.ops.push(pattern ? `[${num(pattern[0] * PT_PER_MM)} ${num(pattern[1] * PT_PER_MM)}] 0 d` : "[] 0 d");
  }

  /** Clips everything that follows to the sheet, so no path can bleed onto a neighbour. */
  clipToSheet() {
    this.ops.push("q", `0 0 ${num(this.x(this.sheetWmm))} ${num(this.y(0))} re W n`);
  }
  unclip() {
    this.ops.push("Q");
  }

  line(a: Pt, b: Pt, color: Rgb, widthMm: number, pattern: readonly [number, number] | null = null) {
    this.useStroke(color);
    this.useWidth(widthMm);
    this.useDash(pattern);
    this.ops.push(`${num(this.x(a.x))} ${num(this.y(a.y))} m ${num(this.x(b.x))} ${num(this.y(b.y))} l S`);
  }

  /** Open polyline through `pts` (at least two points). */
  polyline(pts: Pt[], color: Rgb, widthMm: number, pattern: readonly [number, number] | null = null) {
    if (pts.length < 2) return;
    this.useStroke(color);
    this.useWidth(widthMm);
    this.useDash(pattern);
    this.ops.push(this.path(pts, false), "S");
  }

  /** Closed polygon — filled, stroked or both. */
  polygon(pts: Pt[], opts: { fill?: Rgb; stroke?: Rgb; widthMm?: number } = {}) {
    if (pts.length < 3) return;
    // Colour and line state must be set before the painting operator: a PDF
    // content stream reads strictly in order, so a state change emitted after
    // `B` would simply apply to the *next* shape.
    if (opts.fill) this.useFill(opts.fill);
    if (opts.stroke) {
      this.useStroke(opts.stroke);
      this.useWidth(opts.widthMm ?? 0.3);
      this.useDash(null);
    }
    // `B` paints the fill first and the outline after it, so the outline stays crisp.
    this.ops.push(this.path(pts, true), opts.fill && opts.stroke ? "B" : opts.fill ? "f" : "S");
  }

  rect(xMm: number, yMm: number, wMm: number, hMm: number, opts: { fill?: Rgb; stroke?: Rgb; widthMm?: number } = {}) {
    // Reuse the polygon path so fill/stroke order and colour caching stay in one place.
    this.polygon(
      [
        { x: xMm, y: yMm },
        { x: xMm + wMm, y: yMm },
        { x: xMm + wMm, y: yMm + hMm },
        { x: xMm, y: yMm + hMm },
      ],
      opts
    );
  }

  /** Text with its baseline at (`xMm`, `yMm`) from the sheet's top-left corner. */
  text(xMm: number, yMm: number, value: string, opts: TextOptions = {}) {
    const size = opts.size ?? 6;
    const bold = opts.bold ?? false;
    const align = opts.align ?? "start";
    const rotate = opts.rotate ?? 0;

    let x = xMm;
    if (align !== "start") {
      const w = textWidthMm(value, size, bold);
      x -= align === "middle" ? w / 2 : w;
    }

    const rad = (-rotate * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    this.useFill(opts.color ?? INK);
    this.ops.push(
      `BT /${bold ? "F2" : "F1"} ${num(size)} Tf ${num(cos)} ${num(sin)} ${num(-sin)} ${num(cos)} ` +
        `${num(this.x(x))} ${num(this.y(yMm))} Tm (${pdfText(value)}) Tj ET`
    );
  }

  private path(pts: Pt[], close: boolean): string {
    const out: string[] = [];
    pts.forEach((p, i) => {
      out.push(`${num(this.x(p.x))} ${num(this.y(p.y))} ${i === 0 ? "m" : "l"}`);
    });
    if (close) out.push("h");
    return out.join(" ");
  }

  content(): string {
    return this.ops.join("\n");
  }
}

/* ------------------------------------------------------------------ *
 * Document assembly
 * ------------------------------------------------------------------ */

type PdfPage = { wPt: number; hPt: number; content: string };

/**
 * Serializes the pages into one PDF 1.4 file.
 *
 * Five shared objects are numbered up front (catalog, page tree, the two fonts,
 * the info dictionary) and each page then takes two more (the page and its
 * content stream). The xref offsets are byte counts taken from the growing
 * string, which is only exact because everything written here is ASCII — one
 * character, one byte. `pdfText` and `num` keep that promise.
 */
function assemblePdf(pages: PdfPage[], title: string): Uint8Array<ArrayBuffer> {
  const CATALOG = 1;
  const PAGES = 2;
  const FONT_NORMAL = 3;
  const FONT_BOLD = 4;
  const INFO = 5;

  const objects: string[] = [];
  const pageIds: number[] = [];
  let next = 6;

  for (const page of pages) {
    const contentId = next++;
    const pageId = next++;
    objects[contentId - 1] = `<< /Length ${page.content.length} >>\nstream\n${page.content}\nendstream`;
    objects[pageId - 1] =
      `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${num(page.wPt)} ${num(page.hPt)}] ` +
      `/Resources << /Font << /F1 ${FONT_NORMAL} 0 R /F2 ${FONT_BOLD} 0 R >> >> ` +
      `/Contents ${contentId} 0 R >>`;
    pageIds.push(pageId);
  }

  objects[CATALOG - 1] = `<< /Type /Catalog /Pages ${PAGES} 0 R >>`;
  objects[PAGES - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  objects[FONT_NORMAL - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[FONT_BOLD - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objects[INFO - 1] = `<< /Title (${pdfText(title)}) /Creator (LetsPoly) /Producer (LetsPoly net exporter) >>`;

  let file = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets[i] = file.length;
    file += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = file.length;
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) file += `${String(offset).padStart(10, "0")} 00000 n \n`;
  file +=
    `trailer\n<< /Size ${objects.length + 1} /Root ${CATALOG} 0 R /Info ${INFO} 0 R >>\n` +
    `startxref\n${xrefStart}\n%%EOF\n`;

  const bytes = new Uint8Array(file.length);
  for (let i = 0; i < file.length; i++) bytes[i] = file.charCodeAt(i) & 0xff;
  return bytes;
}

/* ------------------------------------------------------------------ *
 * The net, in millimetres
 * ------------------------------------------------------------------ */

type NetTabDrawing = {
  /** The four corners of the tab, hinged on its base edge. */
  quad: Pt[];
  label: { at: Pt; rotate: number; mm: number } | null;
};

type NetGeometry = {
  faces: Pt[][];
  cutEdges: Array<[Pt, Pt]>;
  foldEdges: Array<[Pt, Pt]>;
  tabs: NetTabDrawing[];
  widthMm: number;
  heightMm: number;
};

const round3 = (v: number): string => {
  const r = Math.round(v * 1000) / 1000;
  return (r === 0 ? 0 : r).toFixed(3);
};

/** Same rounded endpoint pair for both copies of a shared edge, either direction. */
function edgeKey(a: Pt, b: Pt): string {
  const ka = `${round3(a.x)},${round3(a.y)}`;
  const kb = `${round3(b.x)},${round3(b.y)}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/**
 * The net scaled so its bounding box is exactly `heightMm` tall — the same
 * uniform scale the panel applies, so screen measurements and paper agree.
 *
 * Cut and fold lines are classified the way the preview does it (an edge two
 * faces share is a crease, an edge used once is the outline) with one deliberate
 * difference: a glue tab's base edge is re-labelled as a crease. On screen a
 * solid outer boundary reads as "the net's outline"; on paper the same line
 * would send the scissors straight through the tab's hinge.
 */
function netGeometry(net: NetResult, heightMm: number): NetGeometry | null {
  const { minX, minY, maxX, maxY } = net.bounds;
  const rawW = maxX - minX;
  const rawH = maxY - minY;
  if (!(rawH > 0) || !(heightMm > 0)) return null;

  const scale = heightMm / rawH;
  const at = (x: number, y: number): Pt => ({ x: (x - minX) * scale, y: (y - minY) * scale });

  const faces = net.polygons.map((poly) => poly.map((p) => at(p.x, p.y)));

  const tabBase = new Set<string>();
  const tabs: NetTabDrawing[] = (net.tabs ?? []).map((tab) => {
    const quad = tab.pts.map((p) => at(p.x, p.y));
    const a = at(tab.base.x1, tab.base.y1);
    const b = at(tab.base.x2, tab.base.y2);
    tabBase.add(edgeKey(a, b));

    // The label is the length of the edge the tab glues, tilted with the tab and
    // dropped when the flap is too shallow to hold readable text.
    const depth = Math.hypot(quad[2].x - quad[1].x, quad[2].y - quad[1].y);
    let rotate = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    const upright = ((rotate % 360) + 360) % 360;
    if (upright > 90 && upright < 270) rotate -= 180;
    const centre = quad.reduce((sum, p) => ({ x: sum.x + p.x / quad.length, y: sum.y + p.y / quad.length }), { x: 0, y: 0 });

    return {
      quad,
      label: depth >= 3.4 ? { at: centre, rotate, mm: Math.hypot(b.x - a.x, b.y - a.y) } : null,
    };
  });

  const edges = new Map<string, { a: Pt; b: Pt; count: number }>();
  for (const poly of faces) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const key = edgeKey(a, b);
      const found = edges.get(key);
      if (found) found.count += 1;
      else edges.set(key, { a, b, count: 1 });
    }
  }

  const cutEdges: Array<[Pt, Pt]> = [];
  const foldEdges: Array<[Pt, Pt]> = [];
  edges.forEach((edge, key) => {
    (edge.count >= 2 || tabBase.has(key) ? foldEdges : cutEdges).push([edge.a, edge.b]);
  });

  return { faces, cutEdges, foldEdges, tabs, widthMm: rawW * scale, heightMm };
}

/* ------------------------------------------------------------------ *
 * Sheet caption
 * ------------------------------------------------------------------ */

const CAPTION_W_MM = 66;
const CAPTION_PAD_MM = 2.4;
const CAPTION_ACCENT_MM = 1.1;
const CAPTION_BAR_MM = 50;
const CAPTION_INSET_MM = 3.5;
const LINE_FACTOR = 1.45;

type CaptionRow = { text: string; size: number; bold?: boolean; color?: Rgb };

/** Strips the trailing zeros off a formatted number ("120.0" -> "120", "12.50" -> "12.5"). */
const trim = (value: string) => (value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value);

/**
 * A length in the visitor's unit — mm to at most one decimal, cm to two.
 *
 * This is the only place a length becomes display text: the panel's rows and the
 * printed sheet's caption both call it, so the screen and the paper can never
 * disagree about the unit or the digits. The value handed in is always the
 * internal millimetre one; nothing is rounded before it gets here.
 */
export function fmtLength(mm: number, unit: Unit): string {
  if (!Number.isFinite(mm)) return "-";
  return unit === "cm" ? `${trim((mm / 10).toFixed(2))} cm` : `${trim(mm.toFixed(1))} mm`;
}

function captionRows(input: NetPdfInput, layout: SheetLayout, sheet: number, row: number, col: number): CaptionRow[] {
  const { fit, unit, selected } = input;
  const rows: CaptionRow[] = [
    { text: `LetsPoly - ${selected} net`, size: 7.5, bold: true },
    {
      text:
        `Net ${fmtLength(fit.netWidthMm, unit)} x ${fmtLength(fit.netHeightMm, unit)}` +
        `  |  height ${fmtLength(fit.netHeightMm, unit)}  |  ${unit}`,
      size: 5.8,
      color: MUTED,
    },
    {
      text: `Faces ${fit.faceCount}  |  Vertices ${fit.vertexCount}  |  Edges ${fit.edgeCount}  |  Euler ${fit.euler}`,
      size: 5.8,
      color: MUTED,
    },
    ...fit.edgeRows.map((edge) => ({
      text: `${edge.label} ${fmtLength(edge.mm, unit)}  (x${edge.count})`,
      size: 5.8,
      color: MUTED,
    })),
    { text: "solid line = cut   dashed line = fold   shaded = glue tab", size: 5.5, color: MUTED },
    {
      text:
        `Sheet ${sheet} of ${layout.pages}  |  ${layout.paper} ${layout.sheetWmm} x ${layout.sheetHmm} mm` +
        `${layout.landscape ? " landscape" : ""}  |  print at 100%, no fit-to-page`,
      size: 5.5,
      color: MUTED,
    },
  ];
  if (layout.pages > 1) {
    rows.push({
      text: `Position row ${row + 1}/${layout.rows}, column ${col + 1}/${layout.cols} - butt the sheet edges together`,
      size: 5.5,
      color: MUTED,
    });
  }
  return rows;
}

const rowHeightMm = (size: number) => size * MM_PER_PT * LINE_FACTOR;

const captionHeightMm = (rows: CaptionRow[]) =>
  CAPTION_PAD_MM * 2 + rows.reduce((sum, row) => sum + rowHeightMm(row.size), 0) + 5.6;

/** Draws the caption block with its top-left corner at (`x`, `y`) in sheet mm. */
function drawCaption(canvas: SheetCanvas, x: number, y: number, rows: CaptionRow[]) {
  const h = captionHeightMm(rows);
  canvas.rect(x, y, CAPTION_W_MM, h, { fill: PAPER, stroke: HAIRLINE, widthMm: 0.2 });
  canvas.rect(x, y, CAPTION_ACCENT_MM, h, { fill: ACCENT });

  const textX = x + CAPTION_ACCENT_MM + CAPTION_PAD_MM * 0.4;
  let baseline = y + CAPTION_PAD_MM + rows[0].size * MM_PER_PT;
  for (const row of rows) {
    canvas.text(textX, baseline, row.text, { size: row.size, bold: row.bold, color: row.color ?? INK });
    baseline += rowHeightMm(row.size);
  }

  // 50 mm scale bar: if it really measures 50 mm on paper, the printer honoured
  // 100% scaling — the one thing a true-size template depends on.
  const barY = y + h - CAPTION_PAD_MM - 1.1;
  const barX = textX;
  canvas.line({ x: barX, y: barY }, { x: barX + CAPTION_BAR_MM, y: barY }, INK, 0.4);
  for (const tick of [0, CAPTION_BAR_MM]) {
    canvas.line({ x: barX + tick, y: barY - 1.2 }, { x: barX + tick, y: barY + 1.2 }, INK, 0.4);
  }
  canvas.text(barX + CAPTION_BAR_MM / 2, barY - 1.7, `${CAPTION_BAR_MM} mm check`, {
    size: 5,
    color: MUTED,
    align: "middle",
  });
}



/* ------------------------------------------------------------------ *
 * Drawing a sheet
 * ------------------------------------------------------------------ */

type Segment = { ax: number; ay: number; bx: number; by: number };
type Rect = { x: number; y: number; w: number; h: number };

const cross2 = (ox: number, oy: number, ax: number, ay: number, bx: number, by: number) =>
  (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);

/** True when a segment touches, crosses or lies inside an axis-aligned rectangle. */
function segmentHitsRect(seg: Segment, r: Rect): boolean {
  const inside = (x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  if (inside(seg.ax, seg.ay) || inside(seg.bx, seg.by)) return true;
  // A tab label is a zero-length segment: if its anchor is outside, it is clear.
  if (Math.abs(seg.ax - seg.bx) < 1e-9 && Math.abs(seg.ay - seg.by) < 1e-9) return false;

  const corners: Array<[number, number]> = [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h],
    [r.x, r.y + r.h],
  ];
  return corners.some(([cx, cy], i) => {
    const [dx, dy] = corners[(i + 1) % corners.length];
    const d1 = cross2(cx, cy, dx, dy, seg.ax, seg.ay);
    const d2 = cross2(cx, cy, dx, dy, seg.bx, seg.by);
    const d3 = cross2(seg.ax, seg.ay, seg.bx, seg.by, cx, cy);
    const d4 = cross2(seg.ax, seg.ay, seg.bx, seg.by, dx, dy);
    // A zero means "touching", and counts as a hit: moving the caption to
    // another corner beats printing it across a fold line.
    const straddles = (p: number, q: number) => (p > 0 && q < 0) || (p < 0 && q > 0) || p === 0 || q === 0;
    return straddles(d1, d2) && straddles(d3, d4);
  });
}

/** Everything the net itself draws: edges, tab outlines and tab labels (as points). */
function inkSegments(geo: NetGeometry): Segment[] {
  const segs: Segment[] = [];
  const push = (a: Pt, b: Pt) => segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
  for (const [a, b] of geo.cutEdges) push(a, b);
  for (const [a, b] of geo.foldEdges) push(a, b);
  for (const tab of geo.tabs) {
    tab.quad.forEach((p, i) => push(p, tab.quad[(i + 1) % tab.quad.length]));
    if (tab.label) push(tab.label.at, tab.label.at);
  }
  return segs;
}

/**
 * Picks a corner for the caption that no line, tab or tab label crosses, so the
 * block never hides a crease the visitor has to cut or fold along.
 *
 * A net that fills its paper has no blank corner at all (a 275 mm cube on A4
 * leaves a few millimetres on each side). Then the caption goes to whichever
 * corner the drawing leaves most open, which keeps the damage to a single line
 * instead of whatever the top-left happens to cover.
 */
function captionOrigin(layout: SheetLayout, rows: CaptionRow[], ink: Segment[]): Pt {
  const w = CAPTION_W_MM;
  const h = captionHeightMm(rows);
  const i = CAPTION_INSET_MM;
  const spots: Pt[] = [
    { x: i, y: i },
    { x: layout.sheetWmm - i - w, y: i },
    { x: i, y: layout.sheetHmm - i - h },
    { x: layout.sheetWmm - i - w, y: layout.sheetHmm - i - h },
  ];
  let best = spots[0];
  let fewest = Infinity;
  for (const spot of spots) {
    const rect = { ...spot, w, h };
    const hits = ink.reduce((count, seg) => count + (segmentHitsRect(seg, rect) ? 1 : 0), 0);
    if (hits < fewest) {
      fewest = hits;
      best = spot;
      if (hits === 0) break;
    }
  }
  return best;
}


export type NetPdfInput = {
  selected: string;
  /** The same fit the panel shows, so the file cannot disagree with the screen. */
  fit: NetFit;
  paper: PaperSize;
  unit: Unit;
};

/** Draws sheet (col, row) of the tiling: the net window it shows, plus its caption. */
function drawSheet(
  canvas: SheetCanvas,
  geo: NetGeometry,
  layout: SheetLayout,
  input: NetPdfInput,
  col: number,
  row: number,
  ink: Segment[],
  rows: CaptionRow[]
) {
  // Sheet (col, row) shows the window that begins `col` sheets to the right and
  // `row` sheets down, nudged in by the layout's uniform shift (see SHEET_SHIFT_MM).
  const dx = col * layout.sheetWmm - layout.shiftXmm;
  const dy = row * layout.sheetHmm - layout.shiftYmm;
  const toSheet = (p: Pt): Pt => ({ x: p.x - dx, y: p.y - dy });

  canvas.clipToSheet();
  for (const face of geo.faces) canvas.polygon(face.map(toSheet), { fill: FACE_FILL });
  for (const tab of geo.tabs) canvas.polygon(tab.quad.map(toSheet), { fill: TAB_FILL });

  // Creases go under the cut lines, so a cut is never broken up by dashes.
  for (const [a, b] of geo.foldEdges) canvas.line(toSheet(a), toSheet(b), FOLD_LINE, 0.3, [2.4, 1.8]);
  for (const [a, b] of geo.cutEdges) canvas.line(toSheet(a), toSheet(b), CUT_LINE, 0.45);
  for (const tab of geo.tabs) {
    // Three sides of a tab are cut; the fourth (quad[0] -> quad[1]) is its hinge,
    // which the fold pass above already drew as a dashed line.
    const q = tab.quad.map(toSheet);
    canvas.polyline([q[1], q[2], q[3], q[0]], CUT_LINE, 0.35);
    if (tab.label) {
      const size = 5;
      canvas.text(
        tab.label.at.x - dx,
        tab.label.at.y - dy + size * MM_PER_PT * 0.36,
        fmtLength(tab.label.mm, input.unit),
        { size, color: MUTED, align: "middle", rotate: tab.label.rotate }
      );
    }
  }
  canvas.unclip();

  const moved = ink.map((seg) => ({ ax: seg.ax - dx, ay: seg.ay - dy, bx: seg.bx - dx, by: seg.by - dy }));
  const origin = captionOrigin(layout, rows, moved);
  drawCaption(canvas, origin.x, origin.y, rows);
}

/**
 * The whole printable document — one page per sheet, everything at true size —
 * or null when the solid has no net to export.
 */
export function buildNetPdf(input: NetPdfInput): Uint8Array<ArrayBuffer> | null {
  const net = computeNet(input.selected);
  if (!net) return null;
  const geo = netGeometry(net, input.fit.netHeightMm);
  if (!geo) return null;

  const layout = planSheets(geo.widthMm, geo.heightMm, input.paper);
  const ink = inkSegments(geo);
  const pages: PdfPage[] = [];

  for (let row = 0; row < layout.rows; row++) {
    for (let col = 0; col < layout.cols; col++) {
      const canvas = new SheetCanvas(layout.sheetWmm, layout.sheetHmm);
      const rows = captionRows(input, layout, pages.length + 1, row, col);
      drawSheet(canvas, geo, layout, input, col, row, ink, rows);
      pages.push({
        wPt: layout.sheetWmm * PT_PER_MM,
        hPt: layout.sheetHmm * PT_PER_MM,
        content: canvas.content(),
      });
    }
  }

  return assemblePdf(pages, `LetsPoly - ${input.selected} net`);
}

/** Download name, e.g. `LetsPoly-truncated-icosahedron-net-120mm-A4.pdf`. */
export function netPdfFileName(selected: string, heightMm: number, unit: Unit, paper: PaperSize): string {
  const slug = selected.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const size = unit === "cm" ? trim((heightMm / 10).toFixed(2)) : trim(heightMm.toFixed(1));
  return `LetsPoly-${slug}-net-${size}${unit}-${paper}.pdf`;
}
