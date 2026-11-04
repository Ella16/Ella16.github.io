// 주소 → 좌표 → 역에서 걸어서 몇 분.
// 1) KAKAO_REST_KEY 가 있으면 카카오 주소 검색(한국 주소에 가장 정확)
// 2) 없거나 못 찾으면 OpenStreetMap Nominatim (키 없음, 초당 1회 이하로만 써야 함)
// 걷는 거리는 OpenStreetMap 도보 길찾기(routing.openstreetmap.de)로 재고, 안 되면 직선거리 × 1.3 으로 어림한다.
// 걷는 속도는 국내 지도 서비스들처럼 분당 67m(시속 약 4km)로 잡는다.
const UA = 'buffet-menu-board/1.0 (+https://ella16.github.io/buffet/)';
const WALK_M_PER_MIN = 67;

async function getJSON(url, headers = {}, ms = 5000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(url.split('?')[0] + ' ' + res.status);
  return res.json();
}

export function haversine(a, b) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function kakao(address, key) {
  const H = { Authorization: 'KakaoAK ' + key };
  const q = encodeURIComponent(address);
  const a = await getJSON('https://dapi.kakao.com/v2/local/search/address.json?query=' + q, H);
  let d = a.documents && a.documents[0];
  if (!d) { const k = await getJSON('https://dapi.kakao.com/v2/local/search/keyword.json?query=' + q, H); d = k.documents && k.documents[0]; }
  return d ? { lat: Number(d.y), lng: Number(d.x), via: 'kakao' } : null;
}

// 동·호수, 괄호, 층 같은 꼬리는 OSM 이 못 알아들어서 떼어 가며 다시 찾는다
export function addressVariants(address) {
  const base = address.replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
  const out = [base];
  const m = base.match(/^(.*?(?:로|길)\s*\d+(?:-\d+)?)/);   // 도로명 + 건물번호까지
  if (m) out.push(m[1]);
  const j = base.match(/^(.*?[동리가]\s*\d+(?:-\d+)?)/);    // 지번: 동 + 번지까지
  if (j) out.push(j[1]);
  return [...new Set(out.map(s => s.trim()).filter(Boolean))];
}

async function nominatim(address, near) {
  const box = [near.lng - 0.05, near.lat + 0.05, near.lng + 0.05, near.lat - 0.05].join(',');
  for (const q of addressVariants(address)) {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=kr&accept-language=ko'
      + '&viewbox=' + box + '&q=' + encodeURIComponent(q);
    const r = await getJSON(url);
    if (r && r[0]) return { lat: Number(r[0].lat), lng: Number(r[0].lon), via: 'osm' };
  }
  return null;
}

export async function geocode(address, near, env = process.env) {
  if (env.KAKAO_REST_KEY) {
    try { const k = await kakao(address, env.KAKAO_REST_KEY); if (k) return k; } catch (e) { console.error('kakao', e.message); }
  }
  try { return await nominatim(address, near); } catch (e) { console.error('nominatim', e.message); return null; }
}

export async function walkFrom(station, point) {
  const straight = haversine(station, point);
  try {
    const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${station.lng},${station.lat};${point.lng},${point.lat}?overview=false`;
    const r = await getJSON(url);
    const dist = r && r.routes && r.routes[0] && r.routes[0].distance;
    // 길찾기 결과가 직선의 3배를 넘으면 엉뚱한 길로 본다
    if (dist && dist >= straight * 0.9 && dist <= straight * 3 + 200) return { meters: Math.round(dist), via: 'route' };
  } catch (e) { console.error('route', e.message); }
  return { meters: Math.round(straight * 1.3), via: 'estimate' };
}

export const minutesFor = meters => Math.max(1, Math.ceil(meters / WALK_M_PER_MIN));
