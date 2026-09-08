"""L1 책별 소개문 조회 상태를 CSV 로 뽑는다 (EC2 에서 실행)."""
import json, csv
tier = {}
with open("data4library/enrich_queue.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        tier[row["isbn13"]] = int(row["tier"])
d = {}
for line in open("data4library/d4l_usage.jsonl", encoding="utf-8", errors="replace"):
    try:
        r = json.loads(line)
    except Exception:
        continue
    i = r.get("isbn13")
    if i not in tier or i in d:
        continue
    d[i] = (1 if r.get("ok") else 0, len((r.get("desc") or "").strip()), 1 if r.get("keywords") else 0,
            1 if r.get("co_loan") else 0, (r.get("class_no") or "")[:3])
k = {}
for line in open("kakao_enriched.jsonl", encoding="utf-8", errors="replace"):
    try:
        r = json.loads(line)
    except Exception:
        continue
    i = r.get("isbn13")
    if i not in tier or i in k:
        continue
    k[i] = (1 if r.get("ok") else 0, len((r.get("contents") or "").strip()), (r.get("status") or ""))
with open("/tmp/desc_status.csv", "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f)
    w.writerow(["isbn13", "tier", "d_seen", "d_ok", "d_len", "d_kw", "d_co", "d_class3", "k_seen", "k_ok", "k_len", "k_status"])
    for i, t in tier.items():
        dd = d.get(i); kk = k.get(i)
        w.writerow([i, t, 1 if dd else 0, dd[0] if dd else "", dd[1] if dd else "", dd[2] if dd else "", dd[3] if dd else "", dd[4] if dd else "",
                    1 if kk else 0, kk[0] if kk else "", kk[1] if kk else "", kk[2] if kk else ""])
print("rows", len(tier))
