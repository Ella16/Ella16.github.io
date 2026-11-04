// 회사가 몰린 지역의 역. 좌표는 역 중심 근사값(위도, 경도)이라 도보 시간은 "약"으로 보여 준다.
// 역을 더 넣으려면 여기에 한 줄 추가하고 다시 배포한다. id 는 한 번 쓰면 바꾸지 않는다(저장 경로에 들어간다).
export const STATIONS = [
  // 강남·서초
  { id: 'gangnam', name: '강남역', area: '강남·서초', lat: 37.49795, lng: 127.02763 },
  { id: 'yeoksam', name: '역삼역', area: '강남·서초', lat: 37.50064, lng: 127.03646 },
  { id: 'seolleung', name: '선릉역', area: '강남·서초', lat: 37.50449, lng: 127.04898 },
  { id: 'samseong', name: '삼성역', area: '강남·서초', lat: 37.50887, lng: 127.06311 },
  { id: 'sinnonhyeon', name: '신논현역', area: '강남·서초', lat: 37.50447, lng: 127.02498 },
  { id: 'nonhyeon', name: '논현역', area: '강남·서초', lat: 37.51103, lng: 127.02137 },
  { id: 'hakdong', name: '학동역', area: '강남·서초', lat: 37.51426, lng: 127.03165 },
  { id: 'yangjae', name: '양재역', area: '강남·서초', lat: 37.48436, lng: 127.03427 },
  { id: 'gyodae', name: '교대역', area: '강남·서초', lat: 37.49340, lng: 127.01408 },
  { id: 'seocho', name: '서초역', area: '강남·서초', lat: 37.49187, lng: 127.00760 },
  // 송파
  { id: 'jamsil', name: '잠실역', area: '송파', lat: 37.51328, lng: 127.10013 },
  { id: 'munjeong', name: '문정역', area: '송파', lat: 37.48583, lng: 127.12245 },
  // 도심
  { id: 'cityhall', name: '시청역', area: '도심(종로·중구)', lat: 37.56572, lng: 126.97690 },
  { id: 'gwanghwamun', name: '광화문역', area: '도심(종로·중구)', lat: 37.57103, lng: 126.97672 },
  { id: 'jonggak', name: '종각역', area: '도심(종로·중구)', lat: 37.57019, lng: 126.98307 },
  { id: 'euljiro1', name: '을지로입구역', area: '도심(종로·중구)', lat: 37.56604, lng: 126.98260 },
  { id: 'euljiro3', name: '을지로3가역', area: '도심(종로·중구)', lat: 37.56630, lng: 126.99169 },
  { id: 'seoulstation', name: '서울역', area: '도심(종로·중구)', lat: 37.55465, lng: 126.97059 },
  { id: 'hoehyeon', name: '회현역', area: '도심(종로·중구)', lat: 37.55884, lng: 126.97840 },
  { id: 'seodaemun', name: '서대문역', area: '도심(종로·중구)', lat: 37.56580, lng: 126.96668 },
  { id: 'chungjeongno', name: '충정로역', area: '도심(종로·중구)', lat: 37.55998, lng: 126.96363 },
  // 여의도·영등포
  { id: 'yeouido', name: '여의도역', area: '여의도·영등포', lat: 37.52160, lng: 126.92435 },
  { id: 'nationalassembly', name: '국회의사당역', area: '여의도·영등포', lat: 37.52814, lng: 126.91780 },
  { id: 'yeouinaru', name: '여의나루역', area: '여의도·영등포', lat: 37.52707, lng: 126.93292 },
  { id: 'saetgang', name: '샛강역', area: '여의도·영등포', lat: 37.51722, lng: 126.92882 },
  { id: 'mullae', name: '문래역', area: '여의도·영등포', lat: 37.51800, lng: 126.89474 },
  // 마포·용산
  { id: 'gongdeok', name: '공덕역', area: '마포·용산', lat: 37.54432, lng: 126.95155 },
  { id: 'mapo', name: '마포역', area: '마포·용산', lat: 37.53953, lng: 126.94594 },
  { id: 'dmc', name: '디지털미디어시티역', area: '마포·용산', lat: 37.57703, lng: 126.89970 },
  { id: 'yongsan', name: '용산역', area: '마포·용산', lat: 37.52991, lng: 126.96479 },
  { id: 'samgakji', name: '삼각지역', area: '마포·용산', lat: 37.53470, lng: 126.97310 },
  // 성수
  { id: 'seongsu', name: '성수역', area: '성수', lat: 37.54457, lng: 127.05568 },
  { id: 'ttukseom', name: '뚝섬역', area: '성수', lat: 37.54742, lng: 127.04735 },
  { id: 'seoulforest', name: '서울숲역', area: '성수', lat: 37.54357, lng: 127.04459 },
  // 구로·가산
  { id: 'gurodigital', name: '구로디지털단지역', area: '구로·가산', lat: 37.48521, lng: 126.90151 },
  { id: 'gasandigital', name: '가산디지털단지역', area: '구로·가산', lat: 37.48153, lng: 126.88259 },
  { id: 'sindorim', name: '신도림역', area: '구로·가산', lat: 37.50895, lng: 126.89127 },
  // 마곡
  { id: 'magoknaru', name: '마곡나루역', area: '마곡', lat: 37.56677, lng: 126.82722 },
  { id: 'magok', name: '마곡역', area: '마곡', lat: 37.56022, lng: 126.82541 },
  { id: 'balsan', name: '발산역', area: '마곡', lat: 37.55850, lng: 126.83763 },
  // 판교·분당
  { id: 'pangyo', name: '판교역', area: '판교·분당', lat: 37.39476, lng: 127.11120 },
  { id: 'jeongja', name: '정자역', area: '판교·분당', lat: 37.36700, lng: 127.10828 },
  { id: 'seohyeon', name: '서현역', area: '판교·분당', lat: 37.38500, lng: 127.12333 },
];
export const STATION_BY_ID = new Map(STATIONS.map(s => [s.id, s]));
