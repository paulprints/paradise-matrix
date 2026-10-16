"""Independent Drummond public-output hypotheses, frozen 2026-09-23.
Research only: prices, public-series availability and trading confirmation are
separate. No orders, network calls, indicator modifications or production import.
Recovered from Sep18 public plots; do not call vendor source or exact parity.
"""
from decimal import Decimal, localcontext
import hashlib, json
D = Decimal
VERSION = 'public-output-hypotheses-20260923-v1'
TOL = D('0.00000001')
NEW_NAMES = ['H 1-1','L 1-1','1-1 Dot','Main Channel'] + [f'{family} {side}' for family in ['5-1','5-2','5-2 Ex','5-3','5-9','5-9 Ex','6-1','6-5','6-6','6-7'] for side in ['Sell','Buy']]

def calculate(bars, index):
    """Return unrounded same-raw-index values and strict candidate rule margins.
    This raw slot is displaced on the chart. Does not assign a calendar target.
    Missing history raises KeyError; never fill gaps or translate feed sessions.
    """
    with localcontext() as ctx:
        ctx.prec = 34
        def val(i, key): return D(bars[i][key])
        def p(i): return sum((val(i-j,k) for j in range(3) for k in ['high','low','close']),D(0))/9
        H,L,C,H1,L1 = val(index,'high'),val(index,'low'),val(index,'close'),val(index-1,'high'),val(index-1,'low')
        P,P1,P2 = p(index),p(index-1),p(index-2)
        A = (H+L+C)/3
        R=2*P-sum((val(index-j,'low') for j in range(3)),D(0))/3
        S=2*P-sum((val(index-j,'high') for j in range(3)),D(0))/3
        HH,LL,PH,PL=2*H-H1,2*L-L1,2*P-H,2*P-L
        levels={'Zone Six Top':2*R-S,'Zone Five Top':2*R-P,'Envelope Top':R,'PLDot':P,'Envelope Bottom':S,'Zone Two Bottom':2*S-P,'Zone One Bottom':2*S-R,
          'H 1-1':2*A-L,'L 1-1':2*A-H,'1-1 Dot':A,'Main Channel':2*P1-P2,
          '5-1 Sell':LL,'5-1 Buy':HH,'5-2 Sell':HH,'5-2 Buy':LL,'5-2 Ex Sell':3*H-2*H1,'5-2 Ex Buy':3*L-2*L1,'5-3 Sell':HH,'5-3 Buy':LL,
          '5-9 Sell':2*H-L1,'5-9 Buy':2*L-H1,'5-9 Ex Sell':3*H-2*L1,'5-9 Ex Buy':3*L-2*H1,
          '6-1 Sell':PL,'6-1 Buy':PH,'6-5 Sell':PH,'6-5 Buy':PL,'6-6 Sell':3*H-2*P2,'6-6 Buy':3*L-2*P2,'6-7 Sell':PL,'6-7 Buy':PH}
        # All margins must be strictly positive; equality is NOT certified.
        margins={'5-1 Sell':[LL-C],'5-1 Buy':[C-HH],'5-2 Sell':[H-H1],'5-2 Buy':[L1-L],
          '5-2 Ex Sell':[H-H1],'5-2 Ex Buy':[L1-L],'5-3 Sell':[H1-H,HH-C],'5-3 Buy':[L-L1,C-LL],
          '6-1 Sell':[H-P,PL-C],'6-1 Buy':[P-L,C-PH],'6-5 Sell':[H-P,PH-C],'6-5 Buy':[P-L,C-PL],
          '6-6 Sell':[P2-L,H-P2],'6-6 Buy':[P2-L,H-P2],'6-7 Sell':[P-H],'6-7 Buy':[L-P]}
        return levels,margins

def availability(margins):
    if any(x < -TOL for x in margins): return False
    if any(abs(x) <= TOL for x in margins): return None
    return True

def compare_bytes(raw, source=''):
    records=[json.loads(line) for line in raw.decode('utf-8-sig').splitlines() if line.strip()]
    meta=records[0]; end=records[-1]
    result={'source':source,'sha256':hashlib.sha256(raw).hexdigest(),'metadata':meta,'capture_end':end,'hypothesis_version':VERSION,'tolerance':str(TOL),'production_eligible':False,'certified_live_observations':0,'post_startup':{},'startup_indices':[], 'tail_rows_excluded':0}
    if not end.get('double_read_unchanged',False) or not end.get('bar_count_unchanged',False):
        result['rejected']='unstable_or_incomplete_capture'; return result
    rows={r['index']:r for r in records if r['kind']=='bar'}
    for index,row in rows.items():
        if row.get('excluded_potentially_developing'):
            result['tail_rows_excluded']+=1;continue
        if index<5:
            result['startup_indices'].append(index);continue
        try: levels,margins=calculate(rows,index)
        except KeyError: continue
        for name,candidate in levels.items():
            actual=row['public_plots'][name]
            s=result['post_startup'].setdefault(name,{'rows':0,'valid_price_count':0,'price_matches':0,'price_mismatches':0,'price_mismatch_examples':[],'max_abs_difference':'0','availability_matches':0,'availability_mismatches':0,'boundary_sensitive':0,'boundary_vendor_valid':0,'availability_mismatch_examples':[]})
            s['rows']+=1
            if actual['valid'] and actual['value'] is not None:
                error=abs(candidate-D(actual['value']));s['valid_price_count']+=1
                s['max_abs_difference']=str(max(error,D(s['max_abs_difference'])))
                if error<=TOL:s['price_matches']+=1
                else:
                    s['price_mismatches']+=1
                    if len(s['price_mismatch_examples'])<10:s['price_mismatch_examples'].append({'index':index,'time':row['bar_time_local'],'candidate':str(candidate),'vendor':actual['value'],'difference':str(candidate-D(actual['value']))})
            prediction=availability(margins.get(name,[]))
            if prediction is None:
                s['boundary_sensitive']+=1;s['boundary_vendor_valid']+=int(actual['valid'])
            elif prediction==actual['valid']:s['availability_matches']+=1
            else:
                s['availability_mismatches']+=1
                if len(s['availability_mismatch_examples'])<10:s['availability_mismatch_examples'].append({'index':index,'time':row['bar_time_local'],'candidate_valid':prediction,'vendor_valid':actual['valid']})
    result['unresolved_plot_valid_counts']={name:sum(bool(r['public_plots'][name]['valid']) for r in rows.values() if not r.get('excluded_potentially_developing')) for name in meta['plot_names'] if name not in result['post_startup']}
    return result

def totals(result,names=NEW_NAMES):
    fields=['valid_price_count','price_matches','price_mismatches','availability_matches','availability_mismatches','boundary_sensitive']
    return {k:sum(v[k] for n,v in result.get('post_startup',{}).items() if n in names) for k in fields}

if __name__=='__main__':
    import argparse,pathlib,zipfile
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('input');parser.add_argument('--output',required=True);args=parser.parse_args()
    path=pathlib.Path(args.input);results=[]
    if path.suffix.lower()=='.zip':
        with zipfile.ZipFile(path) as z:
            for name in z.namelist():
                if not name.endswith('.jsonl'):continue
                raw=z.read(name);m=json.loads(raw.splitlines()[0])
                if m.get('capture_mode')=='historical':results.append(compare_bytes(raw,name))
    else: results=[compare_bytes(path.read_bytes(),str(path))]
    pathlib.Path(args.output).write_text(json.dumps(results,indent=2),encoding='utf-8')
    for r in results:print(r['metadata']['capture_id'],r['metadata']['symbol'],r.get('rejected') or totals(r))
