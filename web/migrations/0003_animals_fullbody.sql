-- 0003_animals_fullbody.sql — 동물 8종을 전신 이모지가 있는 것으로 교체 (2026-09-05, 사용자 결정).
--
-- 사자·늑대·개구리는 유니코드에 얼굴 이모지만 있어 트랙에서 머리만 굴러갔다.
-- 전신 이모지가 있는 동물로 바꾸고, 빠른 것과 느린 것을 섞었다 — "거북이가 1등" 이 나와야 재미있다.
-- 0002 시드는 INSERT OR IGNORE 라 여기서 UPDATE 로 덮는다. 코드 A~H 는 게임 코드가 쓰는 이름이라 그대로다.
-- 프로덕션은 관리 API 로 먼저 바꿨고, 이 파일은 새 배포에서도 같은 기본값이 나오게 하는 것이다.
UPDATE animals SET name = '치타',   emoji = '🐆' WHERE code = 'A';
UPDATE animals SET name = '호랑이', emoji = '🐅' WHERE code = 'B';
UPDATE animals SET name = '얼룩말', emoji = '🦓' WHERE code = 'C';
UPDATE animals SET name = '말',     emoji = '🐎' WHERE code = 'D';
UPDATE animals SET name = '기린',   emoji = '🦒' WHERE code = 'E';
UPDATE animals SET name = '캥거루', emoji = '🦘' WHERE code = 'F';
UPDATE animals SET name = '토끼',   emoji = '🐇' WHERE code = 'G';
UPDATE animals SET name = '거북이', emoji = '🐢' WHERE code = 'H';
