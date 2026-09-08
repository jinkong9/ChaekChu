import json, csv, collections, sys
tier = {}
with open("data4library/enrich_queue.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        tier[row["isbn13"]] = int(row["tier"])
T = collections.defaultdict(collections.Counter)
for t in (1, 2, 3):
    T[t]["queue"] = sum(1 for v in tier.values() if v == t)
seen_d = {}
for line in open("data4library/d4l_usage.jsonl", encoding="utf-8", errors="replace"):
    try:
        r = json.loads(line)
    except Exception:
        continue
    i = r.get("isbn13"); t = tier.get(i)
    if not t or i in seen_d:
        continue
    seen_d[i] = (bool(r.get("ok")), len((r.get("desc") or "").strip()) >= 60, bool(r.get("keywords")),
                 bool(r.get("co_loan")), bool(r.get("mania_rec")))
seen_k = {}
for line in open("kakao_enriched.jsonl", encoding="utf-8", errors="replace"):
    try:
        r = json.loads(line)
    except Exception:
        continue
    i = r.get("isbn13"); t = tier.get(i)
    if not t or i in seen_k:
        continue
    seen_k[i] = (bool(r.get("ok")), len((r.get("contents") or "").strip()) >= 60)
for i, t in tier.items():
    c = T[t]
    d = seen_d.get(i); k = seen_k.get(i)
    if d:
        c["d_seen"] += 1; c["d_ok"] += d[0]; c["d_desc"] += d[1]; c["d_kw"] += d[2]; c["co_loan"] += d[3]; c["mania"] += d[4]
    if k:
        c["k_seen"] += 1; c["k_ok"] += k[0]; c["k_desc"] += k[1]
    dd = bool(d and d[1]); kd = bool(k and k[1])
    c["desc_any"] += (dd or kd); c["desc_both"] += (dd and kd)
    c["none_seen"] += ((not dd) and (not kd) and bool(d) and bool(k))
tot = collections.Counter()
for t in (1, 2, 3):
    tot.update(T[t])
cols = [("1단계", T[1]), ("2단계(신간)", T[2]), ("3단계", T[3]), ("L1 전체", tot)]
print(" " * 20 + "".join(f"{name:>18s}" for name, _ in cols))
def row(label, key):
    cells = []
    for _, c in cols:
        cells.append(f"{c[key]:>9,} {c[key]/max(c['queue'],1):5.1%}")
    print(f"{label:20s}" + "".join(f"{x:>18s}" for x in cells))
row("큐", "queue")
row("정보나루 조회", "d_seen"); row("  응답 ok", "d_ok"); row("  소개 60자+", "d_desc"); row("  키워드", "d_kw"); row("  함께대출", "co_loan"); row("  마니아", "mania")
row("카카오 조회", "k_seen"); row("  응답 ok", "k_ok"); row("  소개 60자+", "k_desc")
row("소개 하나라도", "desc_any"); row("소개 둘 다", "desc_both"); row("둘 다 조회했는데 없음", "none_seen")
