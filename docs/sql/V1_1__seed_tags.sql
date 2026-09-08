-- V1.1 — 태그 사전 seed (온보딩 장르 12개). API_SPEC §3.3 라벨↔코드 표 그대로.
-- label 은 설계(DB_TABLE_DESIGN §2 tags)대로 "#라벨" 표시명. 온보딩 화면은 '#' 없는 라벨을 보내고 서버가 맞춰 준다.
-- kind: GENRE(장르) / THEME(소재) / SIGNAL(#신간 같은 상태). 추천 태그(THEME·SIGNAL)는 추천 구현 때 추가한다.
INSERT INTO tags (tag_code, label, kind) VALUES
    ('FICTION',    '#소설',      'GENRE'),
    ('ESSAY',      '#에세이',    'GENRE'),
    ('HUMANITIES', '#인문',      'GENRE'),
    ('HISTORY',    '#역사',      'GENRE'),
    ('SCIENCE',    '#과학',      'GENRE'),
    ('ART',        '#예술',      'GENRE'),
    ('SELF_HELP',  '#자기계발',  'GENRE'),
    ('BUSINESS',   '#경제·경영', 'GENRE'),
    ('SOCIETY',    '#사회',      'GENRE'),
    ('POETRY',     '#시',        'GENRE'),
    ('TRAVEL',     '#여행',      'GENRE'),
    ('TECH',       '#기술·IT',   'GENRE')
ON CONFLICT (tag_code) DO NOTHING;
