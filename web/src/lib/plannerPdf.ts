/**
 * Planner em PDF: o cronograma inteiro (aulas, revisões, provas, prazos das
 * residências) junto com a agenda, num arquivo para guardar ou imprimir.
 *
 * Aqui só o desenho (puro, testável no Node); os dados vêm de
 * plannerPdfData.ts. Carregado sob demanda: o jsPDF não entra no pacote principal.
 */
import { jsPDF } from 'jspdf';
import { tintFor, areaShort, type Tint } from './areas';
import type { AgendaTask } from './agenda';
import { addDays, weekday } from '../../../shared/dates';
import type { StepType } from '../../../shared/residency';

// ============================================================================
// Dados
// ============================================================================

export interface PdfSubject { name: string; area?: string | null; specialty?: string | null; methods: string[]; done: boolean }
export interface PdfReview { name: string; done: boolean; overdue?: boolean }
export interface PdfTask { title: string; time: string | null; kind: AgendaTask['kind']; priority: 1 | 2 | 3 | null; done: boolean; note?: string; checklist: { text: string; done: boolean }[] }
export interface PdfEvent { residency: string; label: string; type: StepType; done: boolean }
export interface PdfDay { date: string; subjects: PdfSubject[]; reviews: PdfReview[]; tasks: PdfTask[]; exams: string[]; events: PdfEvent[]; note?: string }
export interface PdfInput {
  title: string;
  subtitle?: string;
  owner?: string;
  today: string;
  from: string;
  to: string;
  exams: { name: string; date: string | null }[];
  days: PdfDay[];
  /** Tarefas da agenda sem dia marcado. */
  general: PdfTask[];
  /** A agenda entrou no arquivo (mostra a seção mesmo vazia). */
  withAgenda: boolean;
  withReviews: boolean;
}

// ============================================================================
// Desenho
// ============================================================================

type RGB = [number, number, number];
const C = {
  ink: [28, 27, 25] as RGB,
  ink2: [111, 106, 98] as RGB,
  ink3: [162, 156, 146] as RGB,
  line: [216, 211, 201] as RGB,
  fill: [240, 237, 231] as RGB,
  paper: [251, 249, 244] as RGB,
  today: [229, 72, 77] as RGB,
  white: [255, 255, 255] as RGB,
};
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const TINT: Record<Tint, RGB> = { rose: hex('#f4cfd6'), lilac: hex('#ddd5f6'), butter: hex('#f8ec8c'), mint: hex('#c4ecd4'), sky: hex('#cfe3f7'), peach: hex('#f7dac7') };
const DOT: Record<Tint, RGB> = { rose: hex('#e79aaa'), lilac: hex('#a797e6'), butter: hex('#e3cf3c'), mint: hex('#5fcf92'), sky: hex('#7fb3e6'), peach: hex('#eba37d') };
const TYPE_DOT: Record<StepType, RGB> = { inscricao: DOT.sky, prova: DOT.lilac, resultado: DOT.mint };
const PRIORITY: Record<1 | 2 | 3, { label: string; tint: RGB }> = { 3: { label: 'alta', tint: TINT.rose }, 2: { label: 'média', tint: TINT.butter }, 1: { label: 'baixa', tint: TINT.sky } };

const W = 210, H = 297, MX = 16, TOP = 18, BOTTOM = 284;
const CW = W - 2 * MX;
const WD_SHORT = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const WD_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MON = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const PT = 0.3528; // mm por ponto

/** As fontes padrão do PDF só têm Latin-1: troca o que não cabe nele. */
export function clean(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/[–—−]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/…/g, '...').replace(/•/g, '·').replace(/[→➔]/g, '>')
    .normalize('NFC').replace(/[^\u0000-ÿ]/g, '').replace(/\s+/g, ' ').trim();
}

const day = (d: string) => Number(d.slice(8, 10));
const mon = (d: string) => Number(d.slice(5, 7)) - 1;
const shortD = (d: string, year = true) => `${day(d)} ${MON[mon(d)]}${year ? ` ${d.slice(0, 4)}` : ''}`;
const diff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

class Pdf {
  doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  y = TOP;

  font(style: 'sans' | 'sansBold' | 'serif' | 'serifItalic' | 'serifBold', size: number, color: RGB = C.ink) {
    const [family, weight] = style === 'sans' ? ['helvetica', 'normal'] : style === 'sansBold' ? ['helvetica', 'bold']
      : style === 'serif' ? ['times', 'normal'] : style === 'serifBold' ? ['times', 'bold'] : ['times', 'italic'];
    this.doc.setFont(family, weight);
    this.doc.setFontSize(size);
    this.doc.setTextColor(...color);
    return this;
  }
  text(s: string, x: number, y: number, opts: { align?: 'left' | 'right' | 'center'; spacing?: number; maxWidth?: number } = {}) {
    let t = clean(s);
    if (opts.maxWidth) t = this.fit(t, opts.maxWidth);
    // O alinhamento do jsPDF não conta o espaço entre letras
    const extra = (opts.spacing ?? 0) * t.length;
    const dx = opts.align === 'right' ? -extra : opts.align === 'center' ? -extra / 2 : 0;
    this.doc.text(t, x + dx, y, { align: opts.align, charSpace: opts.spacing, baseline: 'alphabetic' });
  }
  /** Corta com reticências o que não cabe na largura. */
  fit(s: string, w: number) {
    if (this.doc.getTextWidth(s) <= w) return s;
    let t = s;
    while (t.length > 1 && this.doc.getTextWidth(`${t}...`) > w) t = t.slice(0, -1);
    return `${t.trimEnd()}...`;
  }
  wrap(s: string, w: number): string[] { return this.doc.splitTextToSize(clean(s), w) as string[]; }
  width(s: string) { return this.doc.getTextWidth(clean(s)); }
  rule(x1: number, y: number, x2: number, color: RGB = C.line, w = 0.2) {
    this.doc.setDrawColor(...color); this.doc.setLineWidth(w); this.doc.line(x1, y, x2, y);
  }
  rect(x: number, y: number, w: number, h: number, fill: RGB, r = 0) {
    this.doc.setFillColor(...fill);
    if (r) this.doc.roundedRect(x, y, w, h, r, r, 'F'); else this.doc.rect(x, y, w, h, 'F');
  }
  dot(x: number, y: number, r: number, color: RGB) { this.doc.setFillColor(...color); this.doc.circle(x, y, r, 'F'); }
  /** Quadradinho de marcar (com o ✓ desenhado quando feito). */
  box(x: number, y: number, s: number, done: boolean) {
    this.doc.setLineWidth(0.25);
    if (done) {
      this.doc.setFillColor(...C.ink); this.doc.setDrawColor(...C.ink);
      this.doc.roundedRect(x, y, s, s, 0.6, 0.6, 'FD');
      this.doc.setDrawColor(...C.white); this.doc.setLineWidth(0.35);
      this.doc.lines([[s * 0.22, s * 0.22], [s * 0.4, -s * 0.48]], x + s * 0.2, y + s * 0.52);
    } else {
      this.doc.setDrawColor(...C.ink3);
      this.doc.roundedRect(x, y, s, s, 0.6, 0.6, 'S');
    }
  }
  /** Etiqueta com fundo pastel; devolve a largura. */
  chip(label: string, x: number, baseline: number, fill: RGB, size = 6.2, color: RGB = C.ink) {
    this.font('sansBold', size, color);
    const t = clean(label).toUpperCase();
    const w = this.doc.getTextWidth(t) + t.length * 0.25 + 2.4;
    const h = size * PT + 1.6;
    this.rect(x, baseline - size * PT - 0.35, w, h, fill, 0.9);
    this.doc.text(t, x + 1.2, baseline, { charSpace: 0.25 });
    return w;
  }
  page() { this.doc.addPage(); this.y = TOP; }
  /** Garante espaço; se não houver, vai para a próxima folha (e chama `after`). */
  need(h: number, after?: () => void) {
    if (this.y + h <= BOTTOM) return false;
    this.page();
    after?.();
    return true;
  }
}

export function buildPlannerPdf(input: PdfInput): jsPDF {
  const p = new Pdf();
  p.doc.setProperties({ title: clean(`${input.title}${input.subtitle ? ` - ${input.subtitle}` : ''}`), subject: 'Planner de estudos e agenda', creator: 'Residência Planner' });
  cover(p, input);
  for (const m of months(input.from, input.to)) { p.page(); month(p, input, m); }
  p.page();
  daily(p, input);
  if (input.withAgenda && input.general.length) general(p, input);
  footer(p, input);
  return p.doc;
}

// ---------------------------------------------------------------- Capa

function cover(p: Pdf, input: PdfInput) {
  p.rect(0, 0, W, 92, C.paper);
  p.rule(0, 92, W, C.line, 0.3);
  p.font('sansBold', 7.5, C.ink2).text('RESIDÊNCIA PLANNER', MX, 24, { spacing: 0.9 });
  const next = input.exams.filter((e) => e.date && e.date >= input.today).sort((a, b) => a.date!.localeCompare(b.date!))[0];
  const tw = next ? CW - 50 : CW;
  p.font('serif', 38).text(input.title, MX, 45, { maxWidth: tw });
  if (input.subtitle) p.font('serifItalic', 18, C.ink2).text(input.subtitle, MX, 57, { maxWidth: tw });
  p.font('sans', 10, C.ink2).text(`${shortD(input.from)}  a  ${shortD(input.to)}${input.owner ? `   ·   ${input.owner}` : ''}`, MX, 70, { maxWidth: CW });
  p.font('sans', 8, C.ink3).text(`Gerado em ${shortD(input.today)}`, MX, 77);

  // Contagem regressiva para a próxima prova
  if (next) {
    const n = diff(next.date!, input.today);
    p.font('serif', 46, C.today).text(n === 0 ? 'hoje' : String(n), W - MX, 52, { align: 'right' });
    p.font('sansBold', 7, C.ink2).text(n === 0 ? 'É DIA DE PROVA' : n === 1 ? 'DIA PARA A PROVA' : 'DIAS PARA A PROVA', W - MX, 60, { align: 'right', spacing: 0.6 });
    p.font('sans', 8.5, C.ink2).text(`${next.name} · ${shortD(next.date!)}`, W - MX, 66, { align: 'right', maxWidth: 70 });
  }

  // Números do período
  const days = input.days;
  const studyDays = days.filter((d) => d.subjects.length).length;
  const lessons = days.reduce((n, d) => n + d.subjects.length, 0);
  const reviews = days.reduce((n, d) => n + d.reviews.length, 0);
  const tasks = days.reduce((n, d) => n + d.tasks.length, 0);
  const stats: [number, string][] = [[studyDays, 'dias de estudo'], [lessons, 'aulas planejadas']];
  if (input.withReviews) stats.push([reviews, 'revisões']);
  if (input.withAgenda) stats.push([tasks, 'tarefas da agenda']);
  const sw = CW / stats.length;
  stats.forEach(([v, l], i) => {
    const x = MX + i * sw;
    p.font('serif', 30).text(String(v), x, 114);
    p.font('sans', 8.5, C.ink2).text(l, x, 120.5);
    if (i) { p.doc.setDrawColor(...C.line); p.doc.setLineWidth(0.2); p.doc.line(x - 5, 103, x - 5, 122); }
  });
  p.rule(MX, 128, W - MX);
  p.y = 140;

  // Provas
  section(p, 'Provas');
  if (!input.exams.length) { p.font('sans', 10, C.ink3).text('Nenhuma prova escolhida: planner montado à mão.', MX, p.y); p.y += 8; }
  for (const e of input.exams) {
    p.need(14);
    p.font('serif', 15).text(e.date ? shortD(e.date) : 'sem data', MX, p.y);
    p.font('sans', 10).text(e.name, MX + 42, p.y, { maxWidth: CW - 80 });
    if (e.date) {
      const n = diff(e.date, input.today);
      p.font('sans', 8.5, n >= 0 ? C.ink2 : C.ink3).text(n > 1 ? `faltam ${n} dias` : n === 1 ? 'amanhã' : n === 0 ? 'hoje' : 'realizada', W - MX, p.y, { align: 'right' });
      p.font('sans', 7.5, C.ink3).text(WD_LONG[weekday(e.date)], MX, p.y + 4.2);
    }
    p.y += 8;
    p.rule(MX, p.y - 1, W - MX);
    p.y += 6;
  }

  // Prazos das residências no período
  const events = input.days.flatMap((d) => d.events.map((e) => ({ ...e, date: d.date })));
  if (events.length) {
    p.y += 6;
    section(p, 'Datas importantes');
    for (const e of events) {
      if (p.need(7)) section(p, 'Datas importantes (continuação)');
      p.dot(MX + 1.2, p.y - 1.2, 1.1, TYPE_DOT[e.type]);
      p.font('sans', 9.5, e.done ? C.ink3 : C.ink).text(shortD(e.date), MX + 5, p.y);
      p.font('sans', 9.5, e.done ? C.ink3 : C.ink).text(`${e.residency} - ${e.label}${e.done ? ' (feito)' : ''}`, MX + 32, p.y, { maxWidth: CW - 55 });
      p.font('sans', 8, C.ink3).text(WD_LONG[weekday(e.date)], W - MX, p.y, { align: 'right' });
      p.y += 6.2;
    }
  }

  // Legenda das cores
  const areas = [...new Set(input.days.flatMap((d) => d.subjects.map((s) => s.area ?? '')))].filter(Boolean);
  if (areas.length) {
    const y = Math.max(p.y + 8, BOTTOM - 8);
    if (y > BOTTOM) return;
    p.font('sansBold', 6.5, C.ink2).text('ÁREAS', MX, y, { spacing: 0.5 });
    let x = MX + 14;
    for (const a of areas) {
      p.font('sans', 8, C.ink2);
      const w = p.width(areaShort(a)) + 7;
      if (x + w > W - MX) break;
      p.dot(x + 1.2, y - 1.1, 1.1, DOT[tintFor(a)]);
      p.text(areaShort(a), x + 3.4, y);
      x += w;
    }
  }
}

function section(p: Pdf, label: string) {
  p.font('serifItalic', 17).text(label, MX, p.y);
  p.rule(MX + p.width(label) + 4, p.y - 1.5, W - MX);
  p.y += 9;
}

// ---------------------------------------------------------------- Mês

function months(from: string, to: string) {
  const out: string[] = [];
  let m = `${from.slice(0, 7)}-01`;
  while (m <= to) {
    out.push(m);
    const [y, mm] = m.split('-').map(Number);
    m = mm === 12 ? `${y + 1}-01-01` : `${y}-${String(mm + 1).padStart(2, '0')}-01`;
  }
  return out;
}

function month(p: Pdf, input: PdfInput, first: string) {
  const byDate = new Map(input.days.map((d) => [d.date, d]));
  const name = `${MONTHS_LONG[mon(first)]} ${first.slice(0, 4)}`;
  const inMonth = input.days.filter((d) => d.date.slice(0, 7) === first.slice(0, 7));
  p.font('sansBold', 7, C.ink2).text('VISÃO DO MÊS', MX, TOP + 2, { spacing: 0.7 });
  p.font('serif', 30).text(name.charAt(0).toUpperCase() + name.slice(1), MX, TOP + 14);
  const sum = [plural(inMonth.reduce((n, d) => n + d.subjects.length, 0), 'aula', 'aulas')];
  if (input.withReviews) sum.push(plural(inMonth.reduce((n, d) => n + d.reviews.length, 0), 'revisão', 'revisões'));
  if (input.withAgenda) sum.push(plural(inMonth.reduce((n, d) => n + d.tasks.length, 0), 'tarefa', 'tarefas'));
  p.font('sans', 9, C.ink2).text(sum.join('  ·  '), W - MX, TOP + 14, { align: 'right' });

  // Grade: segunda a domingo
  const lead = (weekday(first) + 6) % 7;
  const last = (() => { let d = first; while (addDays(d, 1).slice(0, 7) === first.slice(0, 7)) d = addDays(d, 1); return d; })();
  const rows = Math.ceil((lead + day(last)) / 7);
  const gx = MX, gy = TOP + 24, cw = CW / 7, head = 6;
  const ch = Math.min(40, (BOTTOM - 8 - gy - head) / rows);
  ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'].forEach((w, i) => p.font('sansBold', 6.5, C.ink2).text(w, gx + i * cw + 1.5, gy + 4, { spacing: 0.5 }));
  p.rule(gx, gy + head, gx + CW, C.ink, 0.35);

  for (let i = 0; i < rows * 7; i++) {
    const r = Math.floor(i / 7), c = i % 7;
    const x = gx + c * cw, y = gy + head + r * ch;
    const date = addDays(first, i - lead);
    const own = date.slice(0, 7) === first.slice(0, 7);
    const d = byDate.get(date);
    if (own && c >= 5) p.rect(x, y, cw, ch, C.paper);
    if (d?.exams.length) p.rect(x, y, cw, ch, [253, 238, 240]);
    // Bordas da grade
    p.doc.setDrawColor(...C.line); p.doc.setLineWidth(0.15);
    p.doc.line(x, y + ch, x + cw, y + ch);
    if (c) p.doc.line(x, y, x, y + ch);
    if (!own) continue;
    const isToday = date === input.today;
    p.font('serif', 12, !d ? C.ink3 : isToday ? C.today : C.ink).text(String(day(date)), x + 1.6, y + 5);
    if (isToday) p.font('sansBold', 5, C.today).text('HOJE', x + cw - 1.4, y + 4.4, { align: 'right', spacing: 0.3 });
    if (!d) continue;

    // Conteúdo do dia, em linhas pequenas
    const lh = 2.75, maxY = y + ch - 1.6;
    let ly = y + 9;
    const line = (draw: () => void) => { if (ly > maxY) return false; draw(); ly += lh; return true; };
    for (const e of d.exams) {
      line(() => { const w = p.chip('Prova', x + 1.4, ly, TINT.rose, 5.2); p.font('sansBold', 5.6).text(e, x + 2 + w, ly, { maxWidth: cw - w - 3.2 }); });
      ly += 0.6;
    }
    for (const e of d.events) line(() => { p.dot(x + 2.4, ly - 0.75, 0.7, TYPE_DOT[e.type]); p.font('sans', 5.4, e.done ? C.ink3 : C.ink).text(`${e.residency} - ${e.label}`, x + 3.8, ly, { maxWidth: cw - 4.8 }); });
    const tail = (input.withReviews && d.reviews.length ? 1 : 0) + (d.tasks.length ? 1 : 0);
    const room = Math.max(0, Math.floor((maxY - ly) / lh) + 1 - tail);
    const shown = d.subjects.length > room ? Math.max(0, room - 1) : d.subjects.length;
    d.subjects.slice(0, shown).forEach((s) => line(() => {
      p.dot(x + 2.4, ly - 0.75, 0.7, DOT[tintFor(s.area)]);
      p.font('sans', 5.6, s.done ? C.ink3 : C.ink).text(s.name, x + 3.8, ly, { maxWidth: cw - 4.8 });
    }));
    if (shown < d.subjects.length) line(() => p.font('sans', 5.4, C.ink2).text(`+ ${plural(d.subjects.length - shown, 'aula', 'aulas')}`, x + 3.8, ly));
    if (input.withReviews && d.reviews.length) line(() => p.font('sansBold', 5.4, C.ink2).text(plural(d.reviews.length, 'revisão', 'revisões'), x + 1.6, ly, { maxWidth: cw - 2.6 }));
    if (d.tasks.length) line(() => p.font('sansBold', 5.4, C.ink2).text(plural(d.tasks.length, 'tarefa', 'tarefas'), x + 1.6, ly, { maxWidth: cw - 2.6 }));
  }

  // Legenda
  const ly = gy + head + rows * ch + 6;
  p.dot(MX + 1, ly - 1, 0.9, DOT.lilac);
  p.font('sans', 7, C.ink3).text('cor = área do assunto  ·  dias de prova destacados  ·  detalhes de cada dia nas próximas páginas', MX + 3.5, ly);
}

// ---------------------------------------------------------------- Dia a dia

const LX = MX + 24; // início da coluna de conteúdo
const LW = W - MX - LX;

function daily(p: Pdf, input: PdfInput) {
  p.font('sansBold', 7, C.ink2).text('DIA A DIA', MX, TOP + 2, { spacing: 0.7 });
  p.font('serif', 30).text('Cronograma', MX, TOP + 14);
  p.font('sans', 9, C.ink2).text(`${shortD(input.from)} a ${shortD(input.to)}`, W - MX, TOP + 14, { align: 'right' });
  p.y = TOP + 24;

  let week = '';
  for (const d of input.days) {
    const monday = addDays(d.date, -((weekday(d.date) + 6) % 7));
    if (monday !== week) {
      week = monday;
      const sunday = addDays(monday, 6);
      p.need(22);
      p.y += 2;
      p.rect(MX, p.y - 4.2, CW, 6.2, C.fill, 1);
      p.font('sansBold', 7, C.ink2).text(`SEMANA DE ${day(monday)} ${MON[mon(monday)].toUpperCase()} A ${day(sunday)} ${MON[mon(sunday)].toUpperCase()}`, MX + 2.5, p.y, { spacing: 0.6 });
      const wk = input.days.filter((x) => x.date >= monday && x.date <= sunday);
      p.font('sans', 7, C.ink2).text(plural(wk.reduce((n, x) => n + x.subjects.length, 0), 'aula', 'aulas'), W - MX - 2.5, p.y, { align: 'right' });
      p.y += 8;
    }
    dayBlock(p, input, d);
  }
}

/** Uma linha do dia; `keep`: não fica sozinha no pé da folha (títulos de grupo). */
type Row = { h: number; draw: (y: number) => void; keep?: boolean };

function dayBlock(p: Pdf, input: PdfInput, d: PdfDay) {
  const empty = !d.subjects.length && !d.reviews.length && !d.tasks.length && !d.exams.length && !d.events.length && !d.note;
  const isToday = d.date === input.today;
  const head = (cont = false) => {
    p.font('sansBold', 6.5, isToday ? C.today : C.ink2).text(WD_SHORT[weekday(d.date)], MX, p.y - (empty ? 0 : 3.6), { spacing: 0.5 });
    p.font('serif', empty ? 13 : 22, empty ? C.ink3 : isToday ? C.today : C.ink).text(String(day(d.date)), MX + (empty ? 9 : 0), p.y + (empty ? 0 : 4));
    if (!empty) p.font('sans', 6.5, C.ink3).text(cont ? `${MON[mon(d.date)]} (cont.)` : MON[mon(d.date)], MX, p.y + 8);
  };
  if (empty) {
    p.need(7);
    head();
    p.font('sans', 8, C.ink3).text('Livre', LX, p.y);
    p.rule(LX + 10, p.y - 1, W - MX, C.line, 0.15);
    p.y += 6.5;
    return;
  }

  const rows: Row[] = [];
  // Provas e prazos do dia
  if (d.exams.length || d.events.length) {
    rows.push({ h: 6.5, draw: (y) => {
      let x = LX;
      for (const e of d.exams) {
        x += p.chip(`Prova · ${e}`, x, y, TINT.rose, 6.8) + 2;
      }
      for (const e of d.events) {
        p.font('sans', 8, e.done ? C.ink3 : C.ink);
        const t = p.fit(clean(`${e.residency} - ${e.label}`), Math.max(20, W - MX - x - 4));
        if (x + p.doc.getTextWidth(t) + 5 > W - MX) break;
        p.dot(x + 1, y - 1.1, 1, TYPE_DOT[e.type]);
        p.doc.text(t, x + 3, y);
        x += p.doc.getTextWidth(t) + 7;
      }
    } });
  }
  // O primeiro grupo do dia fica na altura do número; os outros, com um respiro antes
  const group = (label: string, done: number, total: number) => {
    const gap = rows.length ? 3 : 0;
    rows.push({ h: 5.2 + gap, keep: true, draw: (y) => {
      p.font('sansBold', 6.3, C.ink2).text(label, LX, y + gap + 0.4, { spacing: 0.6 });
      p.font('sans', 6.3, C.ink3).text(`${done} de ${total}`, W - MX, y + gap + 0.4, { align: 'right' });
      p.rule(LX, y + gap + 1.6, W - MX, C.ink2, 0.2);
    } });
  };

  if (d.subjects.length) {
    group('ASSUNTOS', d.subjects.filter((s) => s.done).length, d.subjects.length);
    for (const s of d.subjects) {
      p.font('sans', 9.5);
      const tag = clean(s.specialty || areaShort(s.area)).toUpperCase();
      p.font('sansBold', 5.8);
      const tw = tag ? p.doc.getTextWidth(tag) + tag.length * 0.25 + 2.4 + 2 : 0;
      p.font('sans', 9.5);
      const lines = p.wrap(s.name, LW - 7 - tw);
      const methods = s.methods.length ? clean(s.methods.join(' · ')) : '';
      const h = 1.6 + lines.length * 4 + (methods ? 3.4 : 0) + 1.4;
      rows.push({ h, draw: (y) => {
        const by = y + 2.6;
        p.box(LX, by - 2.9, 3.2, s.done);
        let x = LX + 5.5;
        if (tag) { p.chip(tag, x, by - 0.4, TINT[tintFor(s.area)], 5.8, s.done ? C.ink2 : C.ink); x += tw; }
        p.font('sans', 9.5, s.done ? C.ink3 : C.ink);
        lines.forEach((l, i) => p.doc.text(l, x, by + i * 4));
        if (methods) p.font('sans', 7, C.ink3).text(methods, LX + 5.5, by + (lines.length - 1) * 4 + 3.6, { maxWidth: LW - 6 });
        p.rule(LX + 5.5, y + h - 0.2, W - MX, C.fill, 0.15);
      } });
    }
  }
  if (d.reviews.length) {
    group('REVISÕES', d.reviews.filter((r) => r.done).length, d.reviews.length);
    // Duas colunas, que as revisões costumam ser muitas e curtas
    const half = (LW - 4) / 2;
    for (let i = 0; i < d.reviews.length; i += 2) {
      const pair = d.reviews.slice(i, i + 2);
      rows.push({ h: 5.2, draw: (y) => pair.forEach((r, j) => {
        const x = LX + j * (half + 4);
        p.box(x, y + 0.6, 2.8, r.done);
        p.font('sans', 8.5, r.done ? C.ink3 : C.ink).text(r.name + (r.overdue ? '  (atrasada)' : ''), x + 4.6, y + 3, { maxWidth: half - 5 });
      }) });
    }
  }
  if (d.tasks.length) {
    group('AGENDA', d.tasks.filter((t) => t.done).length, d.tasks.length);
    for (const t of d.tasks) rows.push(...taskRows(p, t));
  }
  if (d.note) {
    p.font('serifItalic', 9);
    const lines = p.wrap(d.note, LW - 4);
    rows.push({ h: 2 + lines.length * 3.9, draw: (y) => {
      p.rect(LX, y + 0.4, 0.6, lines.length * 3.9, DOT.rose);
      p.font('serifItalic', 9, C.ink2);
      lines.forEach((l, i) => p.doc.text(l, LX + 2.8, y + 3.3 + i * 3.9));
    } });
  }

  // Cabeçalho + primeira linha juntos; o resto quebra de folha quando precisa
  p.need(Math.max(12, 3 + (rows[0]?.h ?? 0) + (rows[1]?.h ?? 0)));
  p.y += 3;
  const top = p.y, page = p.doc.getNumberOfPages();
  head();
  p.y -= 4;
  rows.forEach((r, i) => {
    if (p.need(r.h + (r.keep ? rows[i + 1]?.h ?? 0 : 0))) { p.y += 5; head(true); p.y -= 4; }
    r.draw(p.y);
    p.y += r.h;
  });
  // O número do dia é mais alto que um dia com pouca coisa
  p.y = (p.doc.getNumberOfPages() === page ? Math.max(p.y, top + 10) : p.y) + 5;
}

function taskRows(p: Pdf, t: PdfTask): Row[] {
  const out: Row[] = [];
  const time = t.kind === 'reminder' ? (t.time ? t.time.slice(0, 5) : 'lembrete') : t.time?.slice(0, 5) ?? '';
  p.font('sans', 7);
  const tw = time ? p.doc.getTextWidth(time) + 2.5 : 0;
  const pr = t.priority ? PRIORITY[t.priority] : null;
  p.font('sans', 9.5);
  const lines = p.wrap(t.title, LW - 6 - tw - (pr ? 14 : 0));
  out.push({ h: 1.4 + lines.length * 4 + 1.2, draw: (y) => {
    const by = y + 2.6;
    p.box(LX, by - 2.9, 3.2, t.done);
    let x = LX + 5.5;
    if (time) { p.font('sansBold', 7, C.ink2).text(time, x, by); x += tw; }
    p.font('sans', 9.5, t.done ? C.ink3 : C.ink);
    lines.forEach((l, i) => p.doc.text(l, x, by + i * 4));
    if (pr) p.chip(pr.label, W - MX - 12, by - 0.3, pr.tint, 5.6);
  } });
  for (const c of t.checklist.filter((c) => clean(c.text))) {
    out.push({ h: 4, draw: (y) => {
      p.box(LX + 6, y + 0.6, 2.4, c.done);
      p.font('sans', 8, c.done ? C.ink3 : C.ink2).text(c.text, LX + 10, y + 2.7, { maxWidth: LW - 11 });
    } });
  }
  if (t.note && clean(t.note)) {
    p.font('sans', 7.5);
    const lines = p.wrap(t.note, LW - 6).slice(0, 4);
    out.push({ h: lines.length * 3.2 + 1, draw: (y) => { p.font('sans', 7.5, C.ink3); lines.forEach((l, i) => p.doc.text(l, LX + 5.5, y + 2.4 + i * 3.2)); } });
  }
  return out;
}

function general(p: Pdf, input: PdfInput) {
  p.need(30);
  p.y += 6;
  section(p, 'Tarefas sem data');
  for (const t of input.general) {
    for (const r of taskRows(p, t)) {
      if (p.need(r.h)) section(p, 'Tarefas sem data (continuação)');
      r.draw(p.y);
      p.y += r.h;
    }
  }
}

// ---------------------------------------------------------------- Rodapé

function footer(p: Pdf, input: PdfInput) {
  const n = p.doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    p.doc.setPage(i);
    p.rule(MX, H - 10.5, W - MX, C.line, 0.15);
    p.font('sans', 7, C.ink3).text(`Residência Planner${input.subtitle ? `  ·  ${input.subtitle}` : ''}`, MX, H - 6.5, { maxWidth: CW - 30 });
    p.font('sans', 7, C.ink3).text(`${i} / ${n}`, W - MX, H - 6.5, { align: 'right' });
  }
}
