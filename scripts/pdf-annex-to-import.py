#!/usr/bin/env python3
"""
Converte os anexos "classificação questão a questão" dos relatórios PDF de análise
(FAMERP, UEL, UNOESTE/HRPP) em arquivos de importação do Residência Planner.

IMPORTANTE: este script NÃO insere nada no banco. Ele só gera arquivos JSON em
data/import/. O administrador revisa e importa esses arquivos pela tela
Administração → Importação (com prévia, validação e confirmação explícita).

Uso:
  pip install pymupdf
  python3 scripts/pdf-annex-to-import.py <famerp.pdf> <uel.pdf> <unoeste.pdf>

Hierarquia gerada: area (grande área) → specialty (especialidade, opcional) →
subject (assunto, unidade do planner) → subsubject (subassunto, opcional).
Na FAMERP o "Tema" já é um assunto e o "Subtema" vira subassunto; na UEL e na
UNOESTE o "Tema" é uma especialidade (ex.: Obstetrícia) e o "Subtema" é o assunto.

Os relatórios não trazem o enunciado das questões, apenas a classificação e o
resumo do que cada questão cobra. Por isso os campos "statement" e
"alternative_*" ficam vazios: o sistema não inventa o que não está na fonte.
"""
import json, re, sys, os, unicodedata
sys.path.insert(0, os.path.dirname(__file__))
from pdf_annex_spans import parse

OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'import')

AREAS = {
    'CM': 'Clínica Médica', 'Clínica Médica': 'Clínica Médica', 'ClínicaMédica': 'Clínica Médica',
    'CIR': 'Cirurgia', 'Cirurgia': 'Cirurgia',
    'PED': 'Pediatria', 'Pediatria': 'Pediatria',
    'GO': 'Ginecologia e Obstetrícia', 'Ginecologia/Obstetrícia': 'Ginecologia e Obstetrícia',
    'Ginecologia/ Obstetrícia': 'Ginecologia e Obstetrícia', 'Ginecologia eObstetrícia': 'Ginecologia e Obstetrícia',
    'Ginecologia e Obstetrícia': 'Ginecologia e Obstetrícia',
    'PREV': 'Medicina Preventiva e Social', 'Preventiva/Saúde Coletiva': 'Medicina Preventiva e Social',
    'Preventiva/SaúdeColetiva': 'Medicina Preventiva e Social',
}
DIFF = {'F': 'easy', 'Fácil': 'easy', 'M': 'medium', 'Média': 'medium', 'D': 'hard', 'Difícil': 'hard'}


def join(cell, bold=None):
    parts = [t for t, b in cell if bold is None or b == bold]
    s = ''
    for p in parts:
        if s.endswith('-') or s.endswith('/') or not s:
            s += p
        else:
            s += ' ' + p
    return re.sub(r'\s+', ' ', s).strip()


def area(raw):
    k = raw.replace('Preventiva/S aúde', 'Preventiva/Saúde').strip()
    k2 = k.replace(' ', '')
    for key, val in AREAS.items():
        if key == k or key.replace(' ', '') == k2:
            return val
    raise ValueError(f'área desconhecida: {raw!r}')


def answer(raw):
    g = raw.strip().upper()
    if g.startswith('X') or g.startswith('ANUL'):
        return None, True
    g = g[:1]
    if g not in 'ABCDE' or not g:
        raise ValueError(f'gabarito inválido: {raw!r}')
    return g, False


def write(name, meta, questions):
    doc = {'format': 'residencia-planner-questions', 'version': 1, **meta, 'questions': questions}
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    print(f'{name}: {len(questions)} questões')


def famerp(pdf):
    rows = parse(pdf, 18, 'Q', 'Análise FAMERP', r'^Prova (20\d\d)$')
    qs = []
    for r in rows:
        c = r['cells']
        year = int(r['label'].split()[-1])
        ans, annulled = answer(join(c[7]))
        qs.append({
            'year': year, 'question_number': int(join(c[0])), 'area': area(join(c[1])),
            'specialty': None, 'subject': join(c[2], True), 'subsubject': join(c[2], False) or None,
            'summary': join(c[3]) or None, 'statement': None,
            'correct_answer': ans, 'annulled': annulled,
            'difficulty': DIFF.get(join(c[5])), 'question_type': join(c[4]) or None,
            'guideline': join(c[6]) or None,
        })
    write('famerp_r1_2021-2026.json', {
        'exam_hint': {'institution': 'FAMERP', 'exam': 'R1 Acesso Direto'},
        'source': 'Relatório "Análise das provas R1 FAMERP 2021–2026" (23/09/2026), Anexo — classificação questão por questão',
    }, qs)


def uel(pdf):
    rows = parse(pdf, 42, 'Q', 'UEL R1 2021', r'^20\d\d$')
    qs = []
    for r in rows:
        c = r['cells']
        ans, annulled = answer(join(c[11]))
        specific, charge = join(c[4]), join(c[5])
        summary = ' — '.join(x for x in [specific, charge] if x)
        qs.append({
            'year': int(r['label']), 'question_number': int(join(c[0])), 'area': area(join(c[1])),
            'specialty': join(c[2]) or None, 'subject': join(c[3]), 'subsubject': None,
            'summary': summary or None, 'statement': None,
            'correct_answer': ans, 'annulled': annulled,
            'difficulty': DIFF.get(join(c[7])), 'question_type': join(c[6]) or None,
            'guideline': join(c[10]) or None,
        })
    write('uel_r1_2021-2026.json', {
        'exam_hint': {'institution': 'HU-UEL', 'exam': 'R1 Acesso Direto'},
        'source': 'Relatório "Análise das provas de R1 Acesso Direto — HU da UEL (2021–2026)", Anexo A — classificação questão a questão',
    }, qs)


def unoeste(pdf):
    rows = parse(pdf, 37, 'Nº', r'Análise das provas UNOESTE|^Anexo, pág', r'^R(1|\+) .* 20\d\d')
    groups = {}
    for r in rows:
        if len(r['cols']) != 10:  # R+ Endoscopia: cópia integral de outras provas, não entra
            continue
        c = r['cells']
        label = r['label']
        year = int(label.split()[-1])
        exam = label.rsplit(' ', 1)[0]
        ans, annulled = answer(join(c[8]))
        guide = join(c[7])
        groups.setdefault(exam, []).append({
            'year': year, 'question_number': int(join(c[0])), 'area': area(join(c[1])),
            'specialty': join(c[2]) or None, 'subject': join(c[3]), 'subsubject': None,
            'summary': join(c[4]) or None, 'statement': None,
            'correct_answer': ans, 'annulled': annulled,
            'difficulty': DIFF.get(join(c[6])), 'question_type': join(c[5]) or None,
            'guideline': 'Depende de diretriz' if guide == 'S' else None,
            'notes': join(c[9]) or None,
        })
    src = 'Relatório "Análise das provas UNOESTE/HRPP — foco R1" (23/09/2026), Anexo E — questões classificadas'
    for exam, qs in groups.items():
        slug = re.sub(r'[^a-z0-9]+', '_', unicodedata.normalize('NFKD', exam.lower().replace('+', 'mais')).encode('ascii', 'ignore').decode()).strip('_')
        years = sorted({q['year'] for q in qs})
        write(f'unoeste_hrpp_{slug}_{years[0]}-{years[-1]}.json', {
            'exam_hint': {'institution': 'UNOESTE/HRPP', 'exam': exam},
            'source': src,
        }, qs)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    famerp(sys.argv[1]); uel(sys.argv[2]); unoeste(sys.argv[3])
