import pymupdf, re, json, sys
def parse(path, start, header_first, footer_re, label_re):
    d=pymupdf.open(path)
    out=[]; label=None
    for i in range(start, len(d)):
        pg=d[i]; spans=[]
        for b in pg.get_text('dict')['blocks']:
            for l in b.get('lines',[]):
                for s in l['spans']:
                    t=s['text'].strip()
                    if t: spans.append(dict(x=s['bbox'][0],y=s['bbox'][1],t=t,bold=bool('Bold' in s['font'] or s['flags']&16)))
        heads=sorted([s for s in spans if s['t']==header_first and s['bold']],key=lambda s:s['y'])
        if not heads: continue
        bounds=[h['y'] for h in heads]+[1e9]
        for k,h in enumerate(heads):
            hy=h['y']; lo=bounds[k]; hi=bounds[k+1]
            for s in spans:
                m=re.match(label_re, s['t'])
                if m and (lo-60 if k==0 else bounds[k-1]) < s['y'] < hy and (k==0 or s['y']>bounds[k-1]):
                    label=m.group(0)
            cols=sorted([s for s in spans if abs(s['y']-hy)<2 and s['bold']], key=lambda s:s['x'])
            colx=[]; names=[]
            for c in cols:
                if colx and c['x']-colx[-1]<3: names[-1]+=c['t']; continue
                colx.append(c['x']); names.append(c['t'])
            # segment body: below header, above next header's label zone
            nxt=hi
            body=[s for s in spans if hy+3<s['y']<nxt-2 and not re.search(footer_re, s['t'])]
            body=[s for s in body if not (s['y']<hy+12 and s['bold'] and not re.match(r'^[A-EX\d]+$',s['t']))]
            body=[s for s in body if not re.match(label_re,s['t'])]
            def col(s):
                k2=0
                for j,x in enumerate(colx):
                    if s['x']>=x-4: k2=j
                return k2
            starts=sorted([s for s in body if col(s)==0 and re.match(r'^\d+$',s['t'])], key=lambda s:s['y'])
            rows=[dict(y=st['y'],cells=[[] for _ in colx],label=label,page=i) for st in starts]
            for s in sorted(body,key=lambda s:(s['y'],s['x'])):
                r=None
                for row in rows:
                    if s['y']>=row['y']-2: r=row
                if r is None: continue
                r['cells'][col(s)].append(s)
            for r in rows:
                out.append(dict(label=r['label'],page=r['page'],cols=names,cells=[[(c['t'],c['bold']) for c in cell] for cell in r['cells']]))
    return out
if __name__=='__main__':
    a=sys.argv
    res=parse(a[1],int(a[2]),a[3],a[4],a[5])
    json.dump(res,open(a[6],'w'),ensure_ascii=False)
    import collections
    print(len(res), collections.Counter(r['label'] for r in res))
