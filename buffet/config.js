// 앱 이름, API 주소, 쿠팡 광고 위젯. apiBase 가 비어 있으면 앱은 "준비 중" 화면을 보여 준다.
window.BUFFET_CONFIG = {
  name: '우리동네 한식뷔페',
  apiBase: 'https://buffet-api.vercel.app',
  // 쿠팡 파트너스 위젯. 어떤 상품이 뜰지는 쿠팡 파트너스 사이트에서 위젯을 만들 때 정해진다.
  // 음식 위젯을 새로 만들면 그 id 로 바꾸면 된다. (지금 값은 첫 페이지와 같은 위젯)
  coupang: { id: 1008876, trackingCode: 'AF3789214' },
};
