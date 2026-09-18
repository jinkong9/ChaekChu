/** 라우트 청크를 받아 오는 동안 자리를 지키는 화면.
 *  페이지마다 다른 자리표시자를 두면 전환할 때 높이가 튀어 보이므로,
 *  이미 쓰고 있는 로딩 표시(.eo-state/.eo-progress) 하나로 통일한다. */
export default function RouteFallback() {
  return (
    <main className="eo-page">
      <div className="eo-state" role="status" aria-label="불러오는 중">
        <span className="eo-progress" />
      </div>
    </main>
  )
}
