import { shops } from "./core.mjs";
import { campaignTypes } from "./campaigns.mjs";
import { rankStampBooks, filterBenefits, selectHomeDeals } from "./customer.mjs";

const paths = {
  mark: '<path d="M4 9h13v4a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6zm13 1h2a2 2 0 0 1 0 4h-2M4 22h14M9 3c-2 1-2 3 0 4m4-5c-2 1-2 3 0 4"/>',
  home: '<path d="m3 11 9-7 9 7M6 10v10h12V10m-8 10v-6h4v6"/>',
  map: '<path d="M19 10c0 5-7 10-7 10S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.4"/>',
  ticket: '<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4zM14 7v2m0 2v2m0 2v2"/>',
  scan: '<path d="M8 4H4v4m12-4h4v4m0 8v4h-4M4 16v4h4M8 8h3v3H8zm5 0h3v3h-3zm-5 5h3v3H8zm5 0h3v3h-3z"/>',
  user: '<circle cx="12" cy="8" r="3"/><path d="M5 20v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2z"/>',
  bell: '<path d="M5 16h14l-2-3V9a5 5 0 0 0-10 0v4zm5 3a2 2 0 0 0 4 0"/>',
  arrow: '<path d="M5 12h13m-5-5 5 5-5 5"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  bag: '<path d="M5 8h14l1 12H4zm4 2V7a3 3 0 0 1 6 0v3"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  search: '<circle cx="10" cy="10" r="5"/><path d="m14 14 5 5"/>',
  heart: '<path d="M20.8 8.7c0 4.4-8.8 10-8.8 10s-8.8-5.6-8.8-10C3.2 4.4 8.5 3.2 12 7c3.5-3.8 8.8-2.6 8.8 1.7Z"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  pos: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  tag: '<path d="M7 5h8l5 5-9 9-7-7z"/><circle cx="10" cy="9" r="1"/><path d="M17 3a5 5 0 0 1 4 4"/>',
  note: '<path d="M6 4h12v16l-3-2-3 2-3-2-3 2zM9 8h6m-6 4h6"/>',
};
export const icon = name => '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + paths[name] + '</svg>';
export const html = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const dateLabel = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" });
const dateTime = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const won = value => value.toLocaleString("ko-KR") + "원";
export const shopById = id => shops.find(shop => shop.id === id);
export const orderLabels = { submitted: "접수 대기", preparing: "제조 중", ready: "픽업 가능", pickedUp: "픽업 완료", cancelled: "취소됨" };
const sourceLabels = { nfc: "키링 적립", qr: "QR 적립", receipt: "사후 적립", pickup: "픽업 적립", campaign: "혜택 구매 적립" };
const deadline = expiry => "D-" + Math.max(0, Math.ceil((expiry - Date.now()) / 86400000));

export const button = (label, action, kind = "", attrs = "") => `<button type="button" class="button ${kind}" data-action="${action}" ${attrs}>${label}</button>`;
const navButton = (label, destination, kind = "") => button(label, "navigate", kind, 'data-page="' + destination + '"');
const portrait = shop => `<span class="shop-icon ${shop.tone}" aria-hidden="true">${html(shop.initials)}</span>`;
const heading = (title, detail = "") => `<header class="page-head"><h1>${html(title)}</h1>${detail ? '<p>' + html(detail) + '</p>' : ""}</header>`;
const empty = (message, action = "") => `<div class="empty card">${icon("mark")}<p>${message}</p>${action}</div>`;
const couponTitle = coupon => coupon.title ?? shopById(coupon.shop)?.reward ?? "보유 쿠폰";
const couponTerms = coupon => coupon.kind === "campaign"
  ? `${html(coupon.itemName)} 1개 · 할인 전 ${won(coupon.minPurchase)} 이상 구매 · ${won(coupon.discountAmount)} 혜택 · 1인 1회${benefitSchedule(coupon) ? ' · ' + benefitSchedule(coupon) : ''}`
  : "발급 매장에서 " + html(shopById(coupon.shop)?.reward ?? "음료 1잔") + " 교환 · 1회 사용";
const campaignsFor = state => state.profile?.campaigns ?? state.campaigns ?? [];

function benefitSchedule(terms) {
  const days = terms.weekdays?.length ? terms.weekdays.map(day => ["일", "월", "화", "수", "목", "금", "토"][day]).join("·") + "요일" : "";
  const clock = minute => String(Math.floor(minute / 60)).padStart(2, "0") + ":" + String(minute % 60).padStart(2, "0");
  return [days, terms.dailyStart !== null && terms.dailyStart !== undefined ? clock(terms.dailyStart) + "–" + clock(terms.dailyEnd) + " (한국 시간)" : ""].filter(Boolean).join(" · ");
}

function retentionPanel(state) {
  const report = state.overview.retention;
  if (!report) return "";
  const active = report.trial.status === "active";
  return `<section class="section retention-panel" aria-label="재방문 관리"><div class="retention-heading"><div><p class="eyebrow">MOA FOR CAFE</p><h2>오늘의 고객 관리</h2><p class="small muted">첫 만남이 다음 방문으로 이어지도록.</p></div>${button(active ? "파일럿 이용 안내" : "프로 파일럿 안내", "dialog", "secondary", 'data-dialog="retention-trial"')}</div>
    ${!state.server ? '<p class="small muted">체험용 시연 고객이 포함돼요. 실제 매장 서버에는 만들지 않습니다.</p>' : ''}<div class="retention-summary"><span>기록된 이용 고객 <b>${report.customers}명</b></span><span>다른 날 다시 이용 <b>${report.returned}명</b></span><span>앱 내 혜택 수신 동의 <b>${report.consented}명</b></span></div>
    <div class="retention-actions">${report.segments.map(segment => `<article class="retention-action"><div><span class="eyebrow">${segment.id === "second" ? "SECOND VISIT" : "WELCOME BACK"}</span><h3>${segment.id === "second" ? "두 번째 방문을 기다려요" : "단골의 안부를 물어보세요"}</h3><p class="small muted">${segment.id === "second" ? "이용일 1일 · 마지막 이용 후 7일 이상" : "이용일 2일 이상 · 마지막 이용 후 21일 이상"}</p></div><div class="retention-action-foot"><p><strong>${segment.count}</strong>명 <small>혜택 안내 가능 ${segment.eligible}명</small></p>${button("재방문 혜택 만들기", "retention-campaign", "secondary", 'data-value="' + segment.id + '"' + (!active || !segment.eligible ? " disabled" : ""))}</div>${!segment.eligible ? '<p class="small muted">조건에 맞고 수신에 동의한 고객이 생기면 시작할 수 있어요.</p>' : ""}</article>`).join("")}</div>
    ${active ? `<p class="small muted pilot-note">무료 파일럿 · ${dateLabel.format(report.trial.endsAt)}까지 · 자동 결제 없음</p>` : '<p class="small muted pilot-note">프로 파일럿에서 대상별 혜택 등록을 30일간 무료로 시험하세요. 결제와 외부 메시지 발송은 연결되지 않았어요.</p>'}
    <details class="retention-details"><summary>집계 기준과 고객 보기</summary><p class="small muted">이 매장의 MOA 적립·혜택 사용·픽업 완료 기록 기준입니다. 한국 시간 같은 날의 기록은 1일로 합쳐요. 실제 첫 방문이나 추가 매출을 증명하지 않아요.</p>
    ${active && report.rows.length ? '<div class="retention-customers">' + report.rows.slice(0, 30).map(row => '<div class="row"><div><b>' + html(row.name) + '</b><small>확인된 이용 ' + row.days + '일 · 마지막 이용 ' + row.absentDays + '일 전</small></div><span class="small">' + (row.consent ? "앱 내 혜택 수신" : "수신 동의 없음") + '</span></div>').join("") + '</div>' : '<p class="small muted">파일럿 이용 중 이 매장의 이용 기록이 있는 고객만 표시해요.</p>'}</details></section>`;
}

function customerInvitations(state) {
  const list = campaignsFor(state).filter(campaign => campaign.type === "return" && !campaign.reason && campaign.remaining > 0).slice(0, 2);
  if (!list.length) return "";
  return `<section class="section return-invitations" aria-label="내 카페의 초대"><div class="section-title"><h2>내 카페의 초대</h2></div><p class="small muted">혜택 수신을 선택한 카페가 준비했어요.</p>${list.map(campaign => `<article class="return-invitation"><div><p class="benefit-shop">${html(shopById(campaign.shop)?.name)}</p><h3>${html(campaign.title)}</h3><p>${won(campaign.discountAmount)} 할인 · ${html(campaign.itemName)}</p><p class="small muted">할인 전 ${won(campaign.minPurchase)} 이상 · ${dateLabel.format(campaign.endsAt)}까지</p>${benefitSchedule(campaign) ? '<p class="small muted">' + benefitSchedule(campaign) + '</p>' : ""}</div>${button("초대 쿠폰 받기", "claim-campaign", "secondary", 'data-id="' + campaign.id + '"')}</article>`).join("")}</section>`;
}

function dailyDealBanner(state) {
  const deals = selectHomeDeals(campaignsFor(state).filter(campaign => campaign.type !== "return"), shops, state.profile, Date.now(), state.catalog);
  if (!deals.length) return "";
  const selected = deals.find(campaign => campaign.id === state.featuredDeal) ?? deals[0];
  const cafe = shopById(selected.shop);
  const expires = selected.coupon ? state.profile.coupons.find(coupon => coupon.id === selected.coupon)?.expires ?? selected.endsAt : selected.endsAt;
  return `<section class="daily-deals" aria-label="오늘의 카페 혜택">
    <div class="daily-deals-head"><h1>오늘의 카페 혜택</h1>${button("전체 혜택 " + icon("chevron"), "all-benefits", "text")}</div>
    <article class="daily-deal" aria-label="${html(cafe.name)} ${html(selected.itemName)} 혜택">
      <div class="daily-deal-copy"><p class="daily-deal-shop">${html(cafe.name)} · ${html(cafe.area)} · ${campaignTypes[selected.type]}</p>
        <h2>${html(selected.itemName)}<br><strong>${won(selected.discountAmount)} ${selected.type === "sponsor" ? "지원" : "할인"}</strong></h2>
        <p class="daily-deal-price"><del>${won(selected.price)}</del><span>${won(selected.price - selected.discountAmount)}</span></p>
        <p class="daily-deal-terms">할인 전 ${won(selected.minPurchase)} 이상 구매 · 대상 메뉴 1개${selected.type === "first" ? "<br>첫 방문 고객 한정 · 매장에서 확인" : selected.type === "sponsor" ? "<br>주최 기관 참여 코드 필요" : ""}</p>
        <p class="daily-deal-period">${dateTime.format(expires)}까지${selected.coupon ? " · 보유 쿠폰" : " · 남은 " + selected.remaining + "장"}</p>
        ${benefitSchedule(selected) ? '<p class="daily-deal-period">' + benefitSchedule(selected) + '</p>' : ''}
        ${selected.coupon ? button("보유 쿠폰 보기 " + icon("arrow"), "shop-wallet", "daily-deal-cta", 'data-id="' + selected.shop + '"') : state.profile ? button("쿠폰 받기 " + icon("arrow"), "claim-campaign", "daily-deal-cta", 'data-id="' + html(selected.id) + '"') : button("혜택 모아보기 " + icon("arrow"), "all-benefits", "daily-deal-cta")}</div>
      <div class="hero-image daily-deal-image" aria-hidden="true"></div>
    </article>
    ${deals.length > 1 ? '<div class="daily-deal-tabs" role="group" aria-label="다른 카페 혜택">' + deals.map(campaign => button(html(shopById(campaign.shop).name), "featured-deal", "", 'data-id="' + html(campaign.id) + '" aria-label="' + html(shopById(campaign.shop).name) + ' 혜택 보기" aria-pressed="' + (campaign.id === selected.id) + '"')).join("") + '</div>' : ""}
    <p class="daily-deal-caption">제휴 카페의 현재 혜택 · 1인 1회 · ${state.server ? "표시된 구매 조건에 따라 매장에서 사용해요." : "체험용 시연 혜택이에요."}</p>
  </section>`;
}

function benefits(state, shopId = "", preview = false) {
  const list = campaignsFor(state).filter(campaign => (!shopId || campaign.shop === shopId) && (!preview || campaign.type !== "return"));
  const filtered = filterBenefits(list, shops, {
    type: preview ? "all" : state.benefitFilter,
    eligibleOnly: preview || state.benefitEligible,
    favoritesOnly: !preview && state.benefitFavorites,
    favorites: state.favorites,
    query: state.page === "cafes" && !preview ? state.query : "",
  });
  if (preview && !filtered.length) return "";
  if (shopId && !list.length) return "";
  const visible = preview ? filtered.slice(0, 2) : filtered;
  return `<section class="section benefits-list" aria-label="오늘의 혜택"><div class="section-title"><h2>오늘의 혜택</h2>${preview ? button("모든 혜택 " + icon("chevron"), "all-benefits", "text") : '<small>매장 결제 시 사용</small>'}</div>
    ${preview ? '<p class="small muted">지금 받을 수 있는 혜택을 모았어요.</p>' : `<div class="segmented benefit-filters" aria-label="혜택 종류">${[["all", "전체"], ...Object.entries(campaignTypes)].map(([type, label]) => button(label, "benefit-filter", state.benefitFilter === type ? "selected" : "", 'data-value="' + type + '" aria-pressed="' + (state.benefitFilter === type) + '"')).join("")}</div>
    <div class="benefit-options"><label><input id="benefit-eligible" type="checkbox" ${state.benefitEligible ? "checked" : ""}>받을 수 있는 혜택만</label><label><input id="benefit-favorites" type="checkbox" ${state.benefitFavorites ? "checked" : ""}>즐겨찾는 카페만</label></div>`}
    <div class="benefit-rows">${visible.length ? visible.map(campaign => `<article class="benefit-row">
      <div><p class="benefit-shop">${html(shopById(campaign.shop)?.name)} · ${campaignTypes[campaign.type]}</p><h3>${html(campaign.title)}</h3>
      <p class="benefit-value"><span class="original-price">${won(campaign.price)}</span> ${won(campaign.price - campaign.discountAmount)}<span class="benefit-saving">${won(campaign.discountAmount)} ${campaign.type === "sponsor" ? "지원" : "할인"}</span></p>
      <p class="small muted">${html(campaign.itemName)} · 할인 전 ${won(campaign.minPurchase)} 이상 구매${campaign.sponsor ? " · " + html(campaign.sponsor) : ""}${campaign.type === "first" ? " · MOA 기록 및 매장 확인 기준 첫 방문" : ""}</p>
      ${campaign.type === "sponsor" ? '<p class="small muted">주최 기관의 참여 코드가 필요해요.</p>' : ""}
      <p class="small muted">${dateTime.format(campaign.startsAt)} ~ ${dateTime.format(campaign.endsAt)} · 남은 수량 ${campaign.remaining}장</p>
      ${benefitSchedule(campaign) ? '<p class="small muted">' + benefitSchedule(campaign) + '</p>' : ""}</div>
      ${campaign.coupon ? button("쿠폰함 보기", "shop-wallet", "secondary", 'data-id="' + campaign.shop + '"') : button(campaign.reason || "쿠폰 받기", "claim-campaign", "secondary", 'data-id="' + html(campaign.id) + '"' + (campaign.reason ? " disabled" : ""))}</article>`).join("") : '<div class="benefit-empty"><p>조건에 맞는 혜택이 없어요.</p><p class="small muted">종류나 즐겨찾기 조건을 바꾸면 다른 혜택을 볼 수 있어요.</p></div>'}</div></section>`;
}

function campaignPanel(state) {
  const list = state.managedCampaigns ?? [];
  return `<section class="section campaign-management"><div class="section-title"><h2>캠페인 관리</h2>${button("캠페인 등록", "new-campaign")}</div>
    <p class="small muted">구매 확인 후 사용한 쿠폰을 기준으로 수수료를 산정해요. 금액은 계약 확인 전 산정액이며, 청구·정산은 별도로 진행합니다.</p>
    <div class="campaign-rows">${list.length ? list.map(campaign => {
      const stats = campaign.stats;
      const ended = campaign.status === "ended" || campaign.endsAt <= Date.now();
      return `<article class="campaign-report"><div class="section-title"><div><p class="benefit-shop">${campaignTypes[campaign.type]} · ${ended ? "발급 종료" : campaign.startsAt > Date.now() ? "시작 전" : "진행 중"}</p><h3>${html(campaign.title)}</h3></div>
        <div class="controls">${!ended ? button("수정", "edit-campaign", "secondary", 'data-id="' + campaign.id + '"') + button("발급 종료", "end-campaign", "text", 'data-id="' + campaign.id + '"') : ""}</div></div>
      <p class="small muted">${dateTime.format(campaign.startsAt)} ~ ${dateTime.format(campaign.endsAt)} · ${html(shopById(campaign.shop).menu[campaign.item][0])}</p>
      ${benefitSchedule(campaign) ? '<p class="small">' + benefitSchedule(campaign) + '</p>' : ""}
      <p class="small muted">${campaign.dailyLimit ? '하루 발급 최대 ' + campaign.dailyLimit + '장 · ' : ''}추가 발급 가능 예산 ${won(Math.max(0, campaign.budget - stats.committed))}${campaign.type === "return" ? ' · 수신 동의 대상 ' + campaign.recipients.length + '명 · 유입 수수료 없음' : ''}</p>
      ${stats.contributionPerUse !== null && stats.contributionPerUse !== undefined ? '<p class="contribution-note">대상 메뉴 잔당 공헌이익 추정 <b>' + won(stats.contributionPerUse) + '</b> · 사용분 합계 ' + won(stats.observedContribution) + '<small>입력한 변동비와 할인·수수료 기준. 고정비·세금 등 미반영, 추가 매출·순이익과 달라요.' + (campaign.type === "sponsor" ? ' 지원금 수령을 가정한 값이며 실제 입금 내역은 아니에요.' : '') + '</small></p>' : ''}
      ${campaign.type === "sponsor" ? '<p class="small">' + html(campaign.sponsor) + ' · 참여 코드 <b class="invite-code">' + html(campaign.inviteCode) + '</b></p>' : ""}
      <dl class="campaign-metrics"><div><dt>발급 / 한도</dt><dd>${stats.issued} / ${campaign.quantity}장</dd></div><div><dt>사용 / 사용률</dt><dd>${stats.used}장 / ${stats.conversion}%</dd></div><div><dt>이용 고객</dt><dd>${stats.customers}명</dd></div><div><dt>첫 방문 / 후속 이용</dt><dd>${stats.newCustomers} / ${stats.returning}명</dd></div><div><dt>확보 예산 / 총예산</dt><dd>${won(stats.committed)} / ${won(campaign.budget)}</dd></div><div><dt>사용 비용</dt><dd>${won(stats.spent)}</dd></div><div><dt>대상 메뉴 결제 산정액</dt><dd>${won(stats.customerPaid)}</dd></div><div><dt>수수료 산정액</dt><dd>${won(stats.fees)}</dd></div></dl></article>`;
    }).join("") : '<p class="empty">진행할 혜택을 등록하면 발급·사용 성과가 여기에 표시돼요.</p>'}</div></section>`;
}

function campaignForm(state) {
  const campaign = state.campaignFormValues ?? state.campaignDraft;
  const shop = shopById(state.staff.shop);
  const fixed = (campaign?.stats?.issued ?? 0) > 0;
  const disabled = fixed ? " disabled" : "";
  const kind = campaign?.type ?? state.campaignType ?? "first";
  const now = Date.now();
  const localDate = value => { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  return `<form class="form campaign-form" data-form="campaign">
    <label>혜택 종류<select name="type" id="campaign-type" aria-label="혜택 종류"${disabled}>${Object.entries(campaignTypes).map(([value, label]) => '<option value="' + value + '"' + (value === kind ? " selected" : "") + '>' + label + '</option>').join("")}</select></label>
    <label>캠페인 제목<input name="title" maxlength="60" required value="${html(campaign?.title)}" placeholder="예: 오후의 커피 1,000원 할인"></label>
    <label>안내 내용<input name="description" maxlength="200" value="${html(campaign?.description)}" placeholder="사용할 때 알아야 할 내용을 적어주세요"></label>
    ${kind === "sponsor" ? '<label>지원 기관명<input name="sponsor" maxlength="60" required value="' + html(campaign?.sponsor) + '"' + disabled + '></label><p class="small muted">참여 코드는 등록 후 표시돼요. 지급 대상자에게 직접 전달하세요.</p>' : ""}
    ${kind === "return" ? '<label>재방문 대상<select name="segment"' + (state.campaignDraft ? ' disabled' : '') + '><option value="second"' + ((campaign?.segment ?? state.retentionSegment) === "second" ? ' selected' : '') + '>두 번째 방문 · 이용일 1일, 7일 이상 미방문</option><option value="lapsed"' + ((campaign?.segment ?? state.retentionSegment) === "lapsed" ? ' selected' : '') + '>뜸해진 단골 · 이용일 2일 이상, 21일 이상 미방문</option></select></label><p class="small muted">등록 시 조건에 맞고 이 매장의 앱 내 혜택 수신에 동의한 고객에게만 보여요. 외부 메시지는 발송하지 않으며 유입 수수료는 0원입니다.</p>' : ''}
    <label>대상 메뉴<select name="item" aria-label="대상 메뉴"${disabled}>${shop.menu.map(([name, price], index) => '<option value="' + index + '"' + (index === (campaign?.item ?? 0) ? " selected" : "") + '>' + html(name) + ' · ' + won(price) + '</option>').join("")}</select></label>
    <div class="form-pair"><label>할인·지원 금액<input name="discountAmount" type="number" min="1" required value="${campaign?.discountAmount ?? 1000}"${disabled}></label>
    <label>할인 전 최소 구매금액<input name="minPurchase" type="number" min="1" required value="${campaign?.minPurchase ?? shop.menu[0][1]}"${disabled}></label></div>
    <label>시작 일시<input name="startsAt" type="datetime-local" required value="${localDate(campaign?.startsAt ?? now)}"${disabled}></label>
    <label>종료 일시<input name="endsAt" type="datetime-local" required value="${localDate(campaign?.endsAt ?? now + 86400000)}"></label>
    <div class="form-pair"><label>총 발급 수량<input name="quantity" type="number" min="${campaign?.stats?.issued || 1}" max="100000" required value="${campaign?.quantity ?? 20}"></label>
    <label>총예산<input name="budget" type="number" min="1" required value="${campaign?.budget ?? 100000}"></label></div>
    ${kind !== "return" ? `<label>${kind === "time" ? "사용한 대상 메뉴의 할인 후 금액 대비 수수료율 (%)" : "사용 1건당 수수료 (원)"}<input name="fee" type="number" min="0" step="${kind === "time" ? "0.01" : "1"}" required value="${campaign ? (kind === "time" ? campaign.fee / 100 : campaign.fee) : kind === "time" ? 7 : kind === "sponsor" ? 300 : 500}"${disabled}></label>` : ''}
    <fieldset class="campaign-controls"><legend>운영 시간과 비용</legend><label>사용 요일<select name="weekdays"${disabled}><option value="all">매일</option><option value="weekdays"${JSON.stringify(campaign?.weekdays) === '[1,2,3,4,5]' ? ' selected' : ''}>평일</option><option value="weekend"${JSON.stringify(campaign?.weekdays) === '[0,6]' ? ' selected' : ''}>주말</option></select></label>
    <div class="form-pair"><label>매일 시작 시간<input name="dailyStart" type="time" value="${campaign?.dailyStart != null ? String(Math.floor(campaign.dailyStart / 60)).padStart(2, '0') + ':' + String(campaign.dailyStart % 60).padStart(2, '0') : ''}"${disabled}></label><label>매일 종료 시간<input name="dailyEnd" type="time" value="${campaign?.dailyEnd != null ? String(Math.floor(campaign.dailyEnd / 60)).padStart(2, '0') + ':' + String(campaign.dailyEnd % 60).padStart(2, '0') : ''}"${disabled}></label></div>
    <p class="small muted">시간 미입력 시 종일 · 한국 시간 · 픽업은 요청 시각 기준으로 적용해요.</p>
    <label>하루 발급 한도 (0은 별도 제한 없음)<input name="dailyLimit" type="number" min="0" max="100000" value="${campaign?.dailyLimit ?? 0}"${disabled}></label>
    <div class="form-pair"><label>대상 메뉴 변동비 (선택)<input name="variableCost" type="number" min="0" max="1000000" placeholder="재료·포장·결제비 등" value="${campaign?.variableCost ?? ''}"${disabled}></label><label>잔당 최소 공헌이익<input name="minContribution" type="number" min="0" max="1000000" value="${campaign?.minContribution ?? 0}"${disabled}></label></div>
    <p id="campaign-estimate" class="contribution-note" role="status">변동비를 입력하면 등록 전 잔당 금액을 확인할 수 있어요.</p></fieldset>
    <p class="small muted">예산은 할인·지원금과 수수료를 포함해 발급 시 확보합니다. 1인 1장, 기간 내 매장 사용이 가능해요.${fixed ? " 발급된 쿠폰의 메뉴·금액·시작 일시는 고정되며 종료 일시를 연장할 수 있어요." : ""}</p>
    <button class="button" type="submit">${state.campaignDraft ? "캠페인 수정 저장" : "캠페인 등록하기"}</button></form>`;
}

function couponStatus(coupon) {
  if (coupon.voided) return "발급 취소";
  if (coupon.used) return "사용 완료";
  if (coupon.reservedOrder) return "픽업 주문에 적용";
  if (coupon.startsAt > Date.now()) return "사용 시작 전";
  return coupon.expires <= Date.now() ? "기간 만료" : "사용 가능";
}

export function usableCoupons(profile) {
  return (profile?.coupons ?? []).filter(coupon => couponStatus(coupon) === "사용 가능").sort((a, b) => a.expires - b.expires);
}

function activityRows(profile, limit, filter = "") {
  const entries = (profile?.activity ?? []).filter(entry => !filter || entry.shop === filter).slice(0, limit);
  return entries.map(entry => {
    const shop = shopById(entry.shop);
    if (!shop) return "";
    const label = { stamp: sourceLabels[entry.source] ?? "스탬프 적립", cancel: "적립 취소", coupon: "쿠폰 사용" }[entry.type];
    const amount = entry.type === "coupon" ? (entry.value ? won(entry.value) + " 절약" : "쿠폰 1장") : (entry.type === "cancel" ? "−" : "+") + entry.qty + "개";
    return `<div class="activity-row"><span class="activity-icon">${icon(entry.type === "coupon" ? "ticket" : "note")}</span>
      <div><b>${html(shop.name)}</b><small>${dateTime.format(entry.time)} · ${label}</small></div><strong class="${entry.type === "cancel" ? "negative" : ""}">${amount}</strong></div>`;
  }).join("");
}

function stampCard(shop, profile, linked = false) {
  const count = profile?.stamps[shop.id] ?? 0;
  return `<article class="card stamp-card${shop.goal - count === 1 ? " almost-complete" : ""}">
      <div class="shop-head">${portrait(shop)}<div><h3>${html(shop.name)}</h3><small>${html(shop.area)}</small></div>
      <div class="stamp-count"><strong>${count}</strong> / ${shop.goal}</div></div>
      <div class="stamp-grid" role="img" aria-label="스탬프 ${count}개, 쿠폰 기준 ${shop.goal}개">${Array.from({ length: shop.goal }, (_, index) => '<span class="stamp-slot' + (index < count ? ' filled' : '') + '" aria-hidden="true">' + (index < count ? icon("check") : "") + '</span>').join("")}</div>
      <small>${shop.goal - count}개 더 모으면 ${html(shop.reward)}</small>
      ${linked ? button("메뉴 보기 " + icon("arrow"), "shop", "text stamp-shop-link", 'data-id="' + shop.id + '"') : ""}
    </article>`;
}

function savedMenuSection(state, shopId = "", manage = false, compact = false) {
  const menus = (state.profile?.savedMenus ?? []).filter(menu => !shopId || menu.shop === shopId);
  if (!manage && !menus.length) return "";
  return `<section class="section saved-menus"><div class="section-title"><h2>나의 메뉴</h2>${compact ? navButton("전체 보기 " + icon("chevron"), "account", "text") : '<small>자주 마시는 커피</small>'}</div>
    ${menus.length ? '<div class="saved-menu-list">' + (compact ? menus.slice(0, 2) : menus).map(menu => {
      const shop = shopById(menu.shop);
      return `<article class="saved-menu-row"><span class="saved-menu-icon" aria-hidden="true">${icon("mark")}</span><div><h3>${html(menu.title)}</h3><p class="small muted">${html(shop?.name ?? "이전 매장")} · ${menu.lines.map(line => html(line.name) + ' × ' + line.qty).join(" · ")}</p>${menu.note ? '<p class="small muted">' + html(menu.note) + '</p>' : ""}</div><div class="saved-menu-actions">${shop ? button("담기", "load-saved-menu", "secondary", 'data-id="' + html(menu.id) + '" aria-label="' + html(menu.title) + ' 담기"') : ""}${manage ? button("삭제", "confirm-delete-menu", "text", 'data-id="' + html(menu.id) + '" aria-label="' + html(menu.title) + ' 삭제"') : ""}</div></article>`;
    }).join("") + '</div>' : '<p class="small muted saved-menu-empty">매장 메뉴를 담거나 완료한 주문에서 나의 메뉴로 저장하세요. 다음에는 요청사항까지 함께 담을 수 있어요.</p>'}</section>`;
}

function checkoutPriceLines(quote) {
  return `<dl class="checkout-prices"><div><dt>메뉴 금액</dt><dd>${won(quote.subtotal ?? quote.total)}</dd></div>
    ${quote.discountAmount ? '<div class="price-discount"><dt>쿠폰 할인</dt><dd>−' + won(quote.discountAmount) + '</dd></div>' : ""}
    <div class="price-total"><dt>매장 결제 금액</dt><dd>${won(quote.total)}</dd></div></dl>`;
}

function home(state) {
  const { profile } = state;
  const dealBanner = dailyDealBanner(state);
  if (!profile) return dealBanner + heading("내 스탬프북 만들기", "한 계정으로 동네 카페의 스탬프와 쿠폰을 모아보세요.") +
    `<section class="join"><div class="join-image"></div><form class="card form join-form" data-form="join">
      <h2>닉네임으로 시작</h2><label>닉네임<input name="name" maxlength="24" required placeholder="예: 카페러버" autocomplete="nickname"></label>
      <button class="button" type="submit">시작하기 ${icon("arrow")}</button>
      ${button("복구 키로 로그인", "dialog", "secondary", 'data-dialog="restore"')}${navButton("가입 전에 카페 둘러보기", "cafes", "text")}</form></section>`;
  const available = usableCoupons(profile);
  const stamps = Object.values(profile.stamps).reduce((sum, n) => sum + n, 0);
  const saved = profile.coupons.filter(coupon => coupon.used).reduce((sum, coupon) => sum + (coupon.savedAmount ?? coupon.discountAmount ?? shopById(coupon.shop)?.menu[0][1] ?? 0), 0);
  const estimatedSavings = profile.coupons.some(coupon => coupon.used && coupon.savedAmount === undefined && coupon.discountAmount === undefined);
  const pendingOrders = profile.orders.filter(order => ["submitted", "preparing", "ready"].includes(order.status));
  const pending = pendingOrders.find(order => order.status === "ready") ?? pendingOrders[0];
  const lastOrder = profile.orders.find(order => order.status === "pickedUp" && shopById(order.shop));
  const books = rankStampBooks(profile, shops, state.favorites).slice(0, 2);
  const expiring = available.find(coupon => coupon.expires <= Date.now() + state.reminder * 86400000);
  const recent = activityRows(profile, 3);
  return `${dealBanner ? dealBanner + '<div class="home-member-bar"><p>' + html(profile.name) + '님, 안녕하세요.</p>' + button(icon("scan") + ' 매장에 보여줄 QR', "show-pass") + '</div>' : `<section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy"><p class="location">${icon("map")} ${html(state.server && shops.length === 1 ? shops[0].area : "한양대 · 왕십리")}</p>
        <h1 id="hero-title">내 스탬프북</h1><p class="greeting">${html(profile.name)}님, 안녕하세요.</p>
        <div class="hero-actions">${button(icon("scan") + " 매장에 보여줄 QR", "show-pass")}
        ${navButton("주변 카페 보기 " + icon("arrow"), "cafes", "text")}</div></div>
      <div class="hero-image" aria-hidden="true"></div>
    </section>`}
    ${pending ? `<div class="callout pickup-banner" role="status">${icon("bag")}<span><b>${pending.status === "ready" ? "픽업할 커피가 준비됐어요" : "진행 중인 픽업 " + pendingOrders.length + "건"}</b><small>${html(shopById(pending.shop)?.name)} · ${orderLabels[pending.status]}</small></span>${navButton("주문 보기", "orders", "text")}</div>` : ""}
    <section class="benefits section" aria-label="내 혜택">
      <div class="section-title"><h2>내 혜택</h2>${navButton("쿠폰함 " + icon("chevron"), "coupons", "text")}</div>
      <div class="balance">
        <div class="balances"><div><span>사용 가능 쿠폰</span><strong>${available.length}<small>장</small></strong></div>
          <div><span>보유 스탬프</span><strong>${stamps}<small>개</small></strong></div>
          <div><span>쿠폰으로 절약</span><strong>${estimatedSavings ? "약 " : ""}${won(saved)}</strong></div></div>
        ${estimatedSavings ? '<p class="small muted">과거 교환권의 사용 금액이 없어 현재 메뉴 가격으로 추정한 금액이 포함돼요.</p>' : ""}
        ${available.length ? `<button class="reward-link" type="button" data-action="use-coupon" data-id="${html(available[0].id)}">${icon("ticket")}<span><b>${html(couponTitle(available[0]))}</b><small>${html(shopById(available[0].shop)?.name)} · ${dateLabel.format(available[0].expires)}까지${expiring ? " · 만료 임박" : ""}</small></span><strong class="coupon-quick-label">사용 QR ${icon("chevron")}</strong></button>` : ""}
      </div>
    </section>
    ${customerInvitations(state)}
    ${savedMenuSection(state, "", false, true)}
    <section class="section"><div class="section-title"><h2>카페별 스탬프</h2>${button("전체 스탬프 " + icon("chevron"), "stamp-wallet", "text")}</div>
    <div class="grid two">${books.map(book => stampCard(book.shop, profile)).join("")}</div></section>
    ${benefits(state, "", true)}
    ${lastOrder ? `<section class="section recent-order"><div class="section-title"><h2>최근 주문</h2>${navButton("주문 내역 " + icon("chevron"), "orders", "text")}</div><div class="repeat-row"><div><b>${html(shopById(lastOrder.shop).name)}</b><p class="small muted">${lastOrder.lines.map(line => html(line.name) + " × " + line.qty).join(" · ")}</p></div>${button("다시 담기", "repeat-order", "secondary", 'data-id="' + lastOrder.id + '"')}</div></section>` : ""}
    <section class="section shortcuts" aria-label="빠른 메뉴">
      ${navButton(icon("bag") + "<span>픽업 주문 내역</span>" + icon("chevron"), "orders", "shortcut")}
      ${button(icon("note") + "<span>사후 적립</span>" + icon("chevron"), "dialog", "shortcut", 'data-dialog="claim"')}</section>
    <section class="section"><div class="section-title"><h2>최근 활동</h2>${navButton("전체 내역 " + icon("chevron"), "history", "text")}</div>
    ${recent ? '<div class="card activity">' + recent + '</div>' : empty("첫 적립 내역이 여기에 표시돼요.")}</section>`;
}

function wallet(state) {
  const available = usableCoupons(state.profile);
  const reserved = (state.profile?.coupons ?? []).filter(coupon => couponStatus(coupon) === "픽업 주문에 적용");
  const previous = (state.profile?.coupons ?? []).filter(coupon => !["사용 가능", "픽업 주문에 적용"].includes(couponStatus(coupon)))
    .sort((a, b) => (b.used ?? b.voided ?? b.expires) - (a.used ?? a.voided ?? a.expires));
  const stampsView = state.couponTab === "stamps";
  const selected = (state.couponTab === "active" ? [...available, ...reserved] : previous).filter(coupon =>
    (!state.walletShop || coupon.shop === state.walletShop) &&
    (state.walletKind === "all" || (state.walletKind === "reward" ? coupon.kind !== "campaign" : coupon.kind === "campaign")));
  const cards = selected.map(coupon => {
    const shop = shopById(coupon.shop);
    if (!shop) return "";
    const status = couponStatus(coupon);
    return `<article class="ticket-card card"><div class="ticket-main"><div class="shop-head">${portrait(shop)}<div><small>${html(shop.name)}</small><h3>${html(couponTitle(coupon))}</h3></div>
      <span class="pill ${status === "사용 가능" ? (coupon.expires <= Date.now() + state.reminder * 86400000 ? "warn" : "green") : ""}">${status === "사용 가능" ? deadline(coupon.expires) : status}</span></div>
      <p class="small muted">${couponTerms(coupon)}</p>${coupon.startsAt ? '<p class="small muted">' + dateTime.format(coupon.startsAt) + ' ~ ' + dateTime.format(coupon.expires) + '</p>' : ""}</div>
      <div class="ticket-bottom"><span>${dateLabel.format(coupon.expires)}까지</span>
      ${status === "사용 가능" ? button("사용하기 " + icon("arrow"), "use-coupon", "text", 'data-id="' + html(coupon.id) + '"') : status === "픽업 주문에 적용" ? navButton("주문 보기", "orders", "text") : ""}</div></article>`;
  }).join("");
  const books = rankStampBooks(state.profile, shops, state.favorites).filter(book => !state.walletShop || book.shop.id === state.walletShop);
  return heading("쿠폰함", "사용할 쿠폰과 완성에 가까운 스탬프를 모았어요.") +
    `<div class="segmented wallet-tabs" aria-label="쿠폰 상태">${button("사용 가능 " + available.length, "coupon-tab", state.couponTab === "active" ? "selected" : "", 'data-value="active" aria-pressed="' + (state.couponTab === "active") + '"')}${button("스탬프북", "coupon-tab", stampsView ? "selected" : "", 'data-value="stamps" aria-pressed="' + stampsView + '"')}${button("지난 쿠폰 " + previous.length, "coupon-tab", state.couponTab === "past" ? "selected" : "", 'data-value="past" aria-pressed="' + (state.couponTab === "past") + '"')}</div>
    <div class="wallet-controls">${shops.length > 1 ? `<label class="select-field">카페 선택<select id="wallet-shop" aria-label="카페 선택"><option value="">전체 카페</option>${shops.map(shop => '<option value="' + shop.id + '"' + (state.walletShop === shop.id ? " selected" : "") + '>' + html(shop.name) + '</option>').join("")}</select></label>` : ""}
    ${!stampsView ? `<label class="select-field">쿠폰 종류<select id="wallet-kind" aria-label="쿠폰 종류">${[["all", "모든 쿠폰"], ["reward", "스탬프 교환권"], ["campaign", "할인·지원 쿠폰"]].map(([value, label]) => '<option value="' + value + '"' + (state.walletKind === value ? " selected" : "") + '>' + label + '</option>').join("")}</select></label>` : ""}</div>
    ${!stampsView && state.couponTab === "active" && reserved.length ? '<p class="small muted reserved-help">픽업 주문에 적용한 쿠폰은 결제·픽업 확인 때 사용돼요. 주문을 취소하면 유효기간이 남은 쿠폰을 다시 쓸 수 있어요.</p>' : ""}
    ${stampsView ? '<div class="grid two">' + books.map(book => stampCard(book.shop, state.profile, true)).join("") + '</div>' : cards ? '<div class="grid three">' + cards + '</div>' : empty(state.walletShop || state.walletKind !== "all" ? "선택한 조건에 맞는 쿠폰이 없어요." : state.couponTab === "active" ? "사용 가능한 쿠폰이 없어요." : "지난 쿠폰이 없어요.", state.walletShop || state.walletKind !== "all" ? button("필터 초기화", "reset-wallet", "secondary") : navButton("카페 둘러보기", "cafes", "secondary"))}`;
}

export function matchingShops(state) {
  const query = state.query.trim().toLowerCase().replace(/\s/g, "");
  const owned = new Set(usableCoupons(state.profile).map(coupon => coupon.shop));
  return shops.filter(shop => (!query || (shop.name + shop.area).toLowerCase().replace(/\s/g, "").includes(query)) &&
    (state.cafeFilter === "saved" ? state.favorites.includes(shop.id) : state.cafeFilter === "benefits" ? owned.has(shop.id) : true));
}

export function cafeResults(state) {
  if (state.cafesView === "benefits") return benefits(state);
  const visible = matchingShops(state);
  if (!visible.length) return empty("조건에 맞는 카페가 없어요.");
  return (state.mapMode && shops.every(shop => ["pando", "dict", "tiamo"].includes(shop.id)) ? `<div class="district-map" aria-label="한양대와 왕십리 체험 매장 배치도">
    <span class="map-station">왕십리역</span><span class="map-campus">한양대학교</span><span class="map-label">체험 매장 배치도</span>
    ${visible.map(shop => `<button class="map-pin ${shop.id}" type="button" data-action="shop" data-id="${shop.id}">${icon("map")} ${html(shop.name)}</button>`).join("")}</div>` : "") +
    `<div class="grid three">${visible.map(shop => `<article class="card cafe-card">
      <div class="shop-head">${portrait(shop)}<div><h3>${html(shop.name)}</h3><small>${html(shop.area)} · ${html(shop.hours)}</small></div>
        <button class="icon-button favorite ${state.favorites.includes(shop.id) ? "hearted" : ""}" type="button" data-action="favorite" data-id="${shop.id}" aria-label="${html(shop.name)} 즐겨찾기" aria-pressed="${state.favorites.includes(shop.id)}">${icon("heart")}</button></div>
      <div class="cafe-body"><p class="reward-text">${icon("ticket")} ${shop.goal}개 적립 시 ${html(shop.reward)}</p>
      ${campaignsFor(state).some(campaign => campaign.shop === shop.id && !campaign.reason) ? '<p class="small active-benefit">오늘 받을 수 있는 혜택이 있어요</p>' : ""}
      ${button("메뉴 및 픽업 " + icon("arrow"), "shop", "secondary wide", 'data-id="' + shop.id + '"')}</div></article>`).join("")}</div>`;
}

function cafes(state) {
  return heading("주변 카페", "매장별 메뉴와 적립 혜택을 확인하세요.") +
    `<div class="segmented cafe-view-tabs" aria-label="카페 탐색">${button("매장", "cafes-view", state.cafesView === "shops" ? "selected" : "", 'data-value="shops" aria-pressed="' + (state.cafesView === "shops") + '"')}${button("혜택 모아보기", "cafes-view", state.cafesView === "benefits" ? "selected" : "", 'data-value="benefits" aria-pressed="' + (state.cafesView === "benefits") + '"')}</div>
    <label class="search">${icon("search")}<input type="search" id="cafe-query" aria-label="매장 이름 또는 지역 검색" placeholder="${state.cafesView === "benefits" ? "카페·메뉴·혜택 검색" : "매장 이름 또는 지역 검색"}" value="${html(state.query)}"></label>
      ${state.cafesView === "shops" ? `<div class="cafe-controls"><div class="segmented">${[["all", "전체"], ["saved", "즐겨찾기"], ["benefits", "내 쿠폰 매장"]].map(([id, label]) => button(label, "cafe-filter", state.cafeFilter === id ? "selected" : "", 'data-value="' + id + '" aria-pressed="' + (state.cafeFilter === id) + '"')).join("")}</div>
      ${shops.every(shop => ["pando", "dict", "tiamo"].includes(shop.id)) ? button(icon("map") + (state.mapMode ? " 목록 보기" : " 지도 보기"), "map", "secondary", 'aria-pressed="' + state.mapMode + '"') : ""}</div>
      ` : ""}<div id="cafe-results">${cafeResults(state)}</div>`;
}

function shopPage(state) {
  const shop = shopById(state.shop);
  if (!shop) return cafes(state);
  const cart = state.cart[shop.id] ?? {};
  const count = Object.values(cart).reduce((sum, qty) => sum + qty, 0);
  const total = Object.entries(cart).reduce((sum, [id, qty]) => sum + shop.menu[id][1] * qty, 0);
  const owned = usableCoupons(state.profile).filter(coupon => coupon.shop === shop.id);
  return `${navButton("‹ 주변 카페", "cafes", "text back-link")}
    <div class="shop-banner ${shop.tone}">${portrait(shop)}<div><h1>${html(shop.name)}</h1><p>${html(shop.area)} · 영업시간 ${html(shop.hours)}</p></div></div>
    <div class="callout">${icon("ticket")}<span><b>스탬프 ${shop.goal}개를 모으면 ${html(shop.reward)}</b><small>해당 매장에서 적립하고 사용할 수 있어요.</small></span></div>
    ${owned.length ? `<div class="shop-owned-coupons"><span>이 매장에서 쓸 수 있는 쿠폰 <b>${owned.length}장</b></span>${button("쿠폰 보기", "shop-wallet", "text", 'data-id="' + shop.id + '"')}</div>` : ""}
    ${state.profile && state.features?.includes("retention-v1") ? '<div class="store-consent-prompt"><p class="small muted">이 카페의 재방문 혜택을 앱에서 받아볼까요?</p>' + button('혜택 수신 설정', 'dialog', 'text', 'data-dialog="store-consent"') + '</div>' : ''}
    ${savedMenuSection(state, shop.id)}
    <section class="section"><div class="section-title"><h2>메뉴</h2></div><div class="card menu-list">
    ${shop.menu.map(([name, price], index) => {
      const soldOut = state.catalog[shop.id]?.[index];
      const qty = cart[index] ?? 0;
      return `<div class="menu-row"><span class="menu-icon">${icon("mark")}</span><div><b>${html(name)}</b><small>${won(price)}</small></div>
        ${soldOut ? '<span class="pill">품절</span>' : `<div class="stepper">${button("−", "quantity", "", 'data-item="' + index + '" data-change="-1" aria-label="' + html(name) + ' 수량 줄이기"' + (qty ? "" : " disabled"))}<strong>${qty}</strong>${button("+", "quantity", "", 'data-item="' + index + '" data-change="1" aria-label="' + html(name) + ' 담기"')}</div>`}
        </div>`;
    }).join("")}</div></section>
    <div class="cart-panel"><div><small>담은 메뉴 ${count}개</small><strong>${won(total)}</strong></div>
    <div class="cart-actions">${state.profile && state.features?.includes("saved-menus-v1") && count ? button("나의 메뉴 저장", "save-cart", "text") : ""}${button("픽업 요청 " + icon("arrow"), "dialog", "", 'data-dialog="order"' + (count ? "" : " disabled"))}</div></div>${benefits(state, shop.id)}`;
}

function orders(state) {
  const entries = state.profile?.orders ?? [];
  return heading("픽업 주문 내역", "매장 접수부터 픽업까지 진행 상태를 확인하세요.") +
    (entries.length ? '<div class="grid two">' + entries.map(order => {
      const shop = shopById(order.shop);
      const stage = ["submitted", "preparing", "ready", "pickedUp"].indexOf(order.status);
      return `<article class="card order-card"><div class="shop-head">${shop ? portrait(shop) : icon("bag")}<div><h3>${html(shop?.name ?? "이전 매장")}</h3><small>${dateTime.format(order.time)} · ${order.id.slice(-5).toUpperCase()}</small></div><span class="pill green">${orderLabels[order.status]}</span></div>
      ${stage >= 0 ? '<ol class="order-progress" aria-label="주문 진행 상태">' + ["요청", "제조", "준비", "픽업"].map((label, index) => '<li class="' + (index <= stage ? "reached" : "") + '"' + (index === stage ? ' aria-current="step"' : "") + '>' + label + '</li>').join("") + '</ol>' : ""}
      ${order.lines.map(line => `<div class="row"><span>${html(line.name)} × ${line.qty}</span><b>${won(line.price * line.qty)}</b></div>`).join("")}
      ${order.note ? '<p class="order-note"><b>매장 요청</b> ' + html(order.note) + '</p>' : ""}
      ${order.couponId ? '<p class="applied-coupon">' + icon("ticket") + html(order.couponTitle) + (order.status === "cancelled" ? ' · 적용 취소' : order.status === "pickedUp" ? ' · 사용 완료' : ' · 적용 예정') + '</p>' : ""}${checkoutPriceLines(order)}
      <div class="controls">${order.status === "submitted" ? button("요청 취소", "confirm-cancel-order", "secondary", 'data-id="' + order.id + '"') : ""}${order.status === "pickedUp" && shop ? button("다시 담기", "repeat-order", "secondary", 'data-id="' + order.id + '"') + (state.features?.includes("saved-menus-v1") ? button("나의 메뉴 저장", "save-order", "text", 'data-id="' + order.id + '"') : "") : ""}</div></article>`;
    }).join("") + '</div>' : empty("아직 픽업 주문이 없어요.", navButton("주변 카페 보기", "cafes", "secondary")));
}

function history(state) {
  const rows = activityRows(state.profile, 50, state.historyFilter);
  return heading("이용 내역", "스탬프 적립, 적립 취소, 쿠폰 사용을 확인할 수 있어요.") +
    `<label class="select-field">매장<select id="history-filter"><option value="">전체 매장</option>${shops.map(shop =>
      `<option value="${shop.id}" ${state.historyFilter === shop.id ? "selected" : ""}>${html(shop.name)}</option>`).join("")}</select></label>
      ${rows ? '<div class="card activity">' + rows + '</div>' : empty("표시할 이용 내역이 없어요.")}`;
}

function account(state) {
  const { profile, server } = state;
  return heading("마이", "키링과 계정, 알림 설정을 관리하세요.") +
    (profile && state.features?.includes("saved-menus-v1") ? savedMenuSection(state, "", true) : "") +
    `<div class="grid two">
    ${profile ? `<section class="card panel"><div class="section-title"><h2>내 키링</h2><span class="pill ${profile.locked ? "warn" : "green"}">${profile.hasTag ? (profile.locked ? "분실 잠금 중" : "사용 중") : "미등록"}</span></div>
    <div class="keyring-preview" role="img" aria-label="무광 로열 블루 바탕에 흰색 MOA 로고가 있는 키링 디자인 시안"><span class="keyring-ring" aria-hidden="true"></span><div class="keyring-fob" aria-hidden="true">${icon("mark")}<span>MOA</span></div></div>
    <p class="small muted">키링을 등록하거나 교체할 때 매장 직원에게 연결 코드를 보여주세요.</p><p class="code">${html(profile.code)}</p>
    <div class="controls">${profile.hasTag ? button(profile.locked ? "분실 잠금 해제" : "분실 잠금", "dialog", profile.locked ? "secondary" : "danger", 'data-dialog="lock"') : ""}${button(icon("scan") + " 대신 QR 사용", "show-pass", "secondary")}</div></section>` : ""}
    <section class="card panel"><h2>쿠폰 만료 안내</h2><p class="small muted">설정한 기간 안에 만료되는 쿠폰을 홈과 알림에서 확인해요.</p>
      <label class="select-field">만료까지 남은 기간 <select id="reminder">${[1, 3, 7].map(n => `<option value="${n}" ${n === state.reminder ? "selected" : ""}>${n}일 이내</option>`).join("")}</select></label></section>
    ${profile && state.features?.includes("retention-v1") ? '<section class="card panel"><h2>카페별 혜택 수신</h2><p class="small muted">선택한 카페의 재방문 혜택을 앱 안에서 받아요. 기본은 받지 않음이며 언제든 바꿀 수 있어요.</p>' + button('수신 설정 관리', 'dialog', 'secondary', 'data-dialog="store-consent"') + '</section>' : ''}
    ${server && profile ? `<section class="card panel"><h2>계정 복구</h2>
      <p class="small muted">같은 서버에서 새 기기로 바꿀 때 복구 키로 적립과 쿠폰을 가져올 수 있어요.</p>
      ${button(profile.hasRecovery ? "복구 키 다시 발급" : "복구 키 발급", "dialog", "secondary", 'data-dialog="recover-key"')}</section>` : ""}
    <section class="card panel"><h2>이용 내역</h2><div class="controls">${navButton("적립 · 사용 내역", "history", "secondary")}${navButton("픽업 주문 내역", "orders", "secondary")}${profile ? button("사후 적립", "dialog", "secondary", 'data-dialog="claim"') : ""}</div></section>
    <section class="card panel"><h2>매장 운영</h2><p class="small muted">점주와 직원은 매장 화면에서 태그 조회와 적립을 처리할 수 있어요.</p>${navButton(icon("pos") + " 점주 POS", "pos", "secondary")}</section>
    <details class="card settings"><summary>테스트 서버 연결</summary>
      <p class="small muted">${server ? "연결 주소 · " + html(server) : "체험 데이터는 이 기기에 저장돼요."}</p>
      <form class="form" data-form="server"><label>서버 주소<input name="url" type="url" value="${html(server)}" placeholder="http://192.168.0.10:8787" required></label>
      <button class="button" type="submit">서버 연결</button></form>${server ? button("체험 모드로 돌아가기", "demo", "secondary") : ""}</details></div>`;
}

function pos(state) {
  const { staff, found, server, selectedTag, receipt, posNote, catalog, overview, issued } = state;
  const shop = shopById(staff?.shop);
  if (!shop) return heading("점주 POS", server ? "카운터의 매장과 POS PIN을 선택하세요." : "매장을 선택하고 적립을 체험하세요.") +
    `<form class="card form form-narrow" data-form="pos"><label>매장<select name="shop">${shops.map(shop => '<option value="' + shop.id + '">' + html(shop.name) + '</option>').join("")}</select></label>
      ${server ? '<label>POS PIN<input name="pin" type="password" inputmode="numeric" required autocomplete="off"></label>' : ""}
      <button class="button" type="submit">POS 열기</button></form>`;
  const scanPanel = `<section class="card panel">
    <div class="section-title"><h2>고객 조회</h2>${button("새 조회", "clear-scan", "text")}</div>
    <p class="small muted">키링을 리더기에 대거나 고객 QR을 스캔하세요. 코드 입력도 가능해요.</p>
    <form class="inline-form" data-form="tag"><label>키링 ID 또는 QR 코드<input name="tag" maxlength="64" value="${html(selectedTag)}" required autocomplete="off" autocapitalize="characters" spellcheck="false"></label><button type="submit" class="button secondary">조회</button></form>
    ${!server || state.native ? `<div class="controls">${server ? "" : button("체험 키링 태그", "sample", "secondary")}${state.native ? button("휴대폰 NFC로 읽기", "native-scan", "secondary") : ""}</div>` : ""}
    ${posNote ? '<p class="status green">' + html(posNote) + '</p>' : ""}
    ${found?.status === "unregistered" ? `<form class="form" data-form="register"><p class="status">등록되지 않은 키링이에요.</p><label>고객 연결 코드<input name="code" maxlength="10" minlength="10" required autocomplete="off"></label><button type="submit" class="button">키링 등록</button></form>` : ""}
    ${found?.status === "locked" ? '<p class="status warn">분실 잠금 중인 키링이에요. 고객 QR을 받아 주세요.</p>' : ""}
    ${found?.status === "ready" ? `<div class="status green"><b>${html(found.name)}</b><small>${html(shop.name)} 스탬프 ${found.stamps} / ${shop.goal}</small></div>
      ${!found.selectedCoupon ? `<form class="inline-form" data-form="stamp"><label>음료 수량<input name="qty" type="number" min="1" max="20" inputmode="numeric" required value="${receipt?.qty ?? 1}"></label><button class="button" type="submit">적립 승인</button></form>` : '<p class="small active-benefit">고객이 QR에서 선택한 쿠폰을 확인해 주세요.</p>'}
      ${found.coupons.filter(coupon => !found.selectedCoupon || coupon.id === found.selectedCoupon).map(coupon => button((coupon.kind === "campaign" ? html(coupon.title) : "쿠폰 사용") + " · " + dateLabel.format(coupon.expires) + "까지", "confirm-redeem", "secondary", 'data-id="' + html(coupon.id) + '"')).join("")}` : ""}
    </section>`;
  const nextStep = { submitted: ["preparing", "접수하기"], preparing: ["ready", "픽업 준비 완료"], ready: ["pickedUp", "결제·픽업 확인"] };
  const orderRows = (overview.orders ?? []).map(order => {
    const [next, label] = nextStep[order.status];
    return `<div class="pos-order"><div><b>${html(order.name)}</b><small>${order.id.slice(-5).toUpperCase()} · ${orderLabels[order.status]}</small></div>
      <p>${order.lines.map(line => html(line.name) + ' × ' + line.qty).join(" · ")}</p>
      ${order.couponId ? '<p class="applied-coupon">' + icon("ticket") + html(order.couponTitle) + ' · −' + won(order.discountAmount) + '</p><p class="small">매장 결제 ' + won(order.total) + '</p>' : ""}
      ${order.note ? '<p class="order-note"><b>매장 요청</b> ' + html(order.note) + '</p>' : ""}
      <div class="controls">${button(label, "order-step", "", 'data-id="' + order.id + '" data-value="' + next + '"')}${button("취소", "order-step", "secondary", 'data-id="' + order.id + '" data-value="cancelled"')}</div></div>`;
  }).join("");
  const sales = (overview.sales ?? []).map(sale => `<div class="row"><div><b>${html(sale.name)} · ${sale.qty}개</b><small>${dateTime.format(sale.time)} · ${sale.cancelled ? "취소됨" : sourceLabels[sale.source]}</small></div>
    ${sale.reversible ? button("적립 취소", "confirm-reverse", "secondary", 'data-id="' + html(sale.id) + '"') : ""}</div>`).join("");
  return heading(shop.name + " POS", "결제 확인 후 적립하거나 픽업 주문을 처리하세요.") + '<div class="controls pos-shortcuts">' + button(icon('scan') + ' 적립·픽업 바로가기', 'counter-focus', 'secondary') + '</div>' + retentionPanel(state) +
    `<div class="pos-metrics">${[["적립 고객", overview.customers ?? 0, "명"], ["재적립 고객", overview.returning ?? 0, "명"], ["사용 쿠폰", overview.usedCoupons ?? 0, "장"]].map(([label, count, unit]) => `<div class="card"><small>${label}</small><strong>${count}<small>${unit}</small></strong></div>`).join("")}</div>
    <div class="grid two pos-panels">${scanPanel}
    <section class="card panel"><div class="section-title"><h2>픽업 주문</h2>${button("새로고침", "refresh", "text")}</div>
      ${orderRows || '<p class="muted small">처리할 픽업 주문이 없어요.</p>'}</section>
    <section class="card panel"><h2>사후 적립 코드 발행</h2><p class="small muted">누락된 적립의 결제 내역을 확인한 뒤 발행하세요.</p>
      <form class="inline-form" data-form="issue"><label>적립 음료 수량<input name="qty" type="number" min="1" max="20" required value="1"></label><button class="button secondary" type="submit">코드 발행</button></form>
      ${issued ? `<p class="code">${html(issued.code)}</p><small>${dateLabel.format(issued.expires)}까지 1회 사용</small>` : ""}</section>
    <section class="card panel"><h2>최근 적립</h2>${sales || '<p class="muted small">최근 적립 거래가 여기에 표시돼요.</p>'}</section>
    <section class="card panel"><h2>메뉴 품절 관리</h2><div>${shop.menu.map(([name], index) => {
      const sold = catalog[shop.id]?.[index];
      return `<div class="row"><div><b>${html(name)}</b><small>${sold ? "품절" : "판매 중"}</small></div>${button(sold ? "판매 재개" : "품절 처리", "availability", "secondary", 'data-item="' + index + '"')}</div>`;
    }).join("")}</div>${button("POS 로그아웃", "logout", "secondary")}</section></div>${campaignPanel(state)}`;
}

export function shell(state) {
  const { page, profile, reminder, server } = state;
  const views = { home, cafes, coupons: wallet, account, shop: shopPage, orders, history, pos };
  const tabs = [["home", "home", "홈"], ["cafes", "map", "주변 카페"], ["coupons", "ticket", "쿠폰함"], ["account", "user", "마이"]];
  const active = page === "shop" ? "cafes" : ["history", "orders"].includes(page) ? "account" : page;
  const alerts = usableCoupons(profile).filter(coupon => coupon.expires <= Date.now() + reminder * 86400000).length;
  const nav = `<nav class="nav" aria-label="주 메뉴">${tabs.map(([id, symbol, label]) => button(icon(symbol) + "<span>" + label + "</span>", "navigate", "nav-item", 'data-page="' + id + '"' + (active === id ? ' aria-current="page"' : ""))).join("")}</nav>`;
  return `<header class="site-header"><div class="topbar">
    <button class="brand" type="button" data-action="navigate" data-page="home" aria-label="MOA 홈"><span class="brand-mark">${icon("mark")}</span><span class="brand-name">MOA</span></button>
    ${nav}<div class="top-actions">${!server ? '<span class="mode">체험 모드</span>' : ""}
      <button type="button" class="icon-button has-alert" data-action="dialog" data-dialog="alerts" aria-label="알림${alerts ? ' ' + alerts + '건' : ''}">${icon("bell")}${alerts ? "<i></i>" : ""}</button></div>
    </div></header><main id="main">${views[page](state)}</main>`;
}

export function dialogContent(state) {
  const dialog = state.dialog;
  const shop = shopById(state.shop);
  const coupon = state.profile?.coupons.find(entry => entry.id === dialog.id);
  switch (dialog.kind) {
    case "retention-trial": {
      const trial = state.overview.retention?.trial;
      return ["MOA Pro 무료 파일럿", '<p>동의한 고객을 대상으로 두 번째 방문·단골 재방문 혜택을 운영하고 이용 결과를 확인해요.</p><p class="small muted">30일 무료 · 자동 결제 없음 · 앱 안에서만 혜택 제공. 문자·카카오톡·푸시와 정기 결제는 연결되지 않았어요. 종료 후 기본 적립과 이미 발급한 쿠폰은 유지돼요.</p>' + (trial?.status === 'available' ? '<form class="form" data-form="retention-trial"><label class="checkbox-label"><input name="accepted" type="checkbox" required>무료 파일럿 범위와 기간을 확인했습니다</label><button class="button" type="submit">30일 무료 파일럿 시작</button></form>' : '<p class="status">' + (trial?.status === 'active' ? dateTime.format(trial.endsAt) + '까지 이용할 수 있어요.' : '무료 파일럿이 종료됐어요. 자동으로 과금되지 않습니다.') + '</p>')];
    }
    case "store-consent": return ["카페별 혜택 수신", '<p class="small muted">선택한 카페의 맞춤 혜택을 앱 안에서 표시하는 데 동의합니다. 문자·카카오톡 수신 동의와는 별개이며, 다른 카페에 내 이용 내역을 제공하지 않아요. 받지 않아도 적립·기존 쿠폰을 이용할 수 있어요.</p><div class="consent-list">' + shops.map(cafe => {
      const enabled = state.profile.storeConsents?.[cafe.id]?.enabled === true;
      return '<div class="consent-row"><div><b>' + html(cafe.name) + '</b><small>' + (enabled ? '앱 내 혜택 받는 중' : '받지 않음') + '</small></div>' + button(enabled ? '받지 않기' : '혜택 받기', 'store-consent', 'secondary', 'data-id="' + cafe.id + '" data-value="' + (!enabled) + '" aria-label="' + html(cafe.name) + (enabled ? ' 혜택 받지 않기' : ' 혜택 받기') + '"') + '</div>';
    }).join('') + '</div>'];
    case "pass": {
      const usable = state.pass && state.pass.expires > Date.now();
      const selected = state.profile?.coupons.find(entry => entry.id === (state.pass?.coupon || state.pass?.requestedCoupon));
      return [selected ? "쿠폰 사용 QR" : "매장에 보여줄 QR", `${selected ? '<div class="selected-coupon"><p class="benefit-shop">' + html(shopById(selected.shop)?.name) + '</p><h3>' + html(couponTitle(selected)) + '</h3><p class="small muted">' + couponTerms(selected) + '</p><p class="small muted">' + dateTime.format(selected.expires) + '까지</p></div>' : '<p class="muted">적립할 때 직원에게 QR 또는 아래 코드를 보여주세요.</p>'}
        ${selected && !state.pass.coupon ? '<p class="small muted">직원에게 이 쿠폰을 사용한다고 함께 알려주세요.</p>' : ""}
        ${usable ? `<div class="qr-box"><canvas id="pass-qr" width="232" height="232" role="img" aria-label="${selected ? "쿠폰 사용 QR 코드" : "적립용 QR 코드"}"></canvas></div>
          <p class="code qr-code">${html(state.pass.code)}</p><p class="small muted">한 번 사용하거나 <b id="qr-timer"></b>이 지나면 만료돼요.</p>` : '<p class="status warn">새 QR을 발급해 주세요.</p>'}
        ${button("새 QR 발급", "show-pass", "secondary wide", selected ? 'data-coupon="' + html(selected.id) + '"' : "")}`];
    }
    case "coupon": {
      const cafe = shopById(coupon?.shop);
      return ["쿠폰 사용 안내", `<p><b>${html(cafe.name)} · ${html(couponTitle(coupon))}</b></p><p class="muted">${couponTerms(coupon)}</p><p class="muted">매장에서 키링을 태그하거나 QR을 보여주세요. 직원이 확인하면 쿠폰이 1회 차감돼요.</p>
        ${button(icon("scan") + " QR 보여주기", "show-pass", "wide")}`];
    }
    case "alerts": {
      const list = usableCoupons(state.profile).filter(entry => entry.expires <= Date.now() + state.reminder * 86400000);
      return ["쿠폰 만료 알림", list.length ? list.map(entry => `<div class="row"><div><b>${html(shopById(entry.shop).name)}</b><small>${dateLabel.format(entry.expires)}까지</small></div><span class="pill warn">${deadline(entry.expires)}</span></div>`).join("") + navButton("쿠폰함 보기", "coupons", "wide") : '<p class="muted">설정한 기간 안에 만료되는 쿠폰이 없어요.</p>'];
    }
    case "claim": return ["사후 적립", `<p class="muted">결제한 매장에서 받은 코드를 입력하세요. 발행일로부터 7일 안에 한 번 사용할 수 있어요.</p>
      <form class="form" data-form="claim"><label>사후 적립 코드<input name="code" placeholder="RC-…" maxlength="32" required autocomplete="off" autocapitalize="characters"></label><button class="button" type="submit">적립하기</button></form>`];
    case "restore": return ["복구 키로 로그인", `<p class="muted">원래 사용하던 테스트 서버에 연결한 상태에서 복구 키를 입력하세요.</p>
      <form class="form" data-form="restore"><label>복구 키<input name="key" maxlength="64" required autocomplete="off" autocapitalize="characters"></label><button class="button" type="submit">계정 복구</button></form>`];
    case "recover-key": return ["계정 복구 키", state.recoveryKey ? `<p class="muted">새 기기에서 이 키로 로그인할 수 있어요. 본인만 볼 수 있는 곳에 보관하세요.</p><label class="form">복구 키<input class="code" readonly value="${html(state.recoveryKey)}"></label>`
      : `<p class="muted">${state.profile?.hasRecovery ? "새 키를 발급하면 이전 키가 만료돼요." : "기기를 바꿔도 스탬프와 쿠폰을 복원할 수 있어요."}</p>${button("복구 키 발급", "recover-key", "wide")}`];
    case "lock": return [state.profile.locked ? "분실 잠금 해제" : "키링 분실 잠금", `<p class="muted">${state.profile.locked ? "이 키링으로 다시 적립하고 쿠폰을 사용할 수 있어요." : "키링 사용이 중지돼요. 적립과 쿠폰은 계정에 보관됩니다."}</p>${button(state.profile.locked ? "잠금 해제하기" : "잠그기", "lock", "wide")}`];
    case "order": {
      const quote = state.orderQuote;
      return ["픽업 요청 확인", `<p><b>${html(shop.name)} · 매장 결제</b></p>
        ${quote.lines.map(line => `<div class="row"><span>${html(line.name)} × ${line.qty}</span><b>${won(line.price * line.qty)}</b></div>`).join("")}
        ${state.features?.includes("pickup-coupons-v1") ? `<section class="checkout-coupon"><label for="order-coupon">쿠폰 적용</label><select id="order-coupon" aria-label="쿠폰 적용"><option value="">쿠폰 사용 안 함</option>${quote.candidates.map(coupon => '<option value="' + html(coupon.id) + '"' + (quote.coupon?.id === coupon.id ? ' selected' : '') + (coupon.reason ? ' disabled' : '') + '>' + html(coupon.title) + ' · ' + (coupon.reason ? html(coupon.reason) : '−' + won(coupon.discountAmount)) + '</option>').join("")}</select><p class="small muted">${quote.coupon ? html(shop.menu[quote.coupon.item][0]) + " 1개" + (quote.coupon.minPurchase ? " · 할인 전 " + won(quote.coupon.minPurchase) + " 이상 구매" : " 교환") + " · 1장 적용" : "담은 메뉴와 구매 조건에 맞는 보유 쿠폰을 선택하세요."}</p>${quote.coupon ? '<details class="checkout-terms"><summary>쿠폰 사용·취소 안내</summary><p class="small muted">사용 가능한 보유 쿠폰 중 할인 금액이 가장 큰 쿠폰을 먼저 제안해요. 주문 요청 때 유효한 쿠폰은 진행 중인 이 주문에만 적용하고, 직원의 결제·픽업 확인 뒤 사용 처리해요. 취소하면 유효기간이 남은 쿠폰을 다시 쓸 수 있어요.</p></details>' + (quote.coupon.campaignType === "first" ? '<p class="small muted">첫 방문 여부를 매장에서 다시 확인해요.</p>' : '') : ""}</section>` : '<p class="small muted">이 매장은 앱 주문 시 쿠폰 적용을 지원하지 않아요. 쿠폰함의 매장 QR 사용을 이용해 주세요.</p>'}
        ${checkoutPriceLines(quote)}<p class="small muted checkout-stamps">결제·픽업 확인 후 유상 음료 ${quote.stampQty}개 적립 예정</p>
        <label class="form">매장 요청사항 (선택)<textarea id="order-note" aria-label="매장 요청사항 (선택)" maxlength="100" placeholder="예: 일회용 빨대는 빼 주세요">${html(state.orderNotes[shop.id] ?? "")}</textarea></label><p class="small muted">요청 가능 여부는 매장에서 확인해요.</p><p class="muted">매장 접수 후 제조가 시작돼요. 픽업할 때 결제해 주세요.</p>${button("픽업 요청 보내기", "place-order", "wide checkout-submit")}`];
    }
    case "repeat-order": {
      const quote = state.repeatQuote;
      const cafe = shopById(quote.shop);
      return [quote.saved ? "나의 메뉴 담기" : "이전 메뉴 다시 담기", `<p><b>${html(cafe.name)}</b></p>${quote.lines.map(line => '<div class="row"><span>' + html(line.name) + ' × ' + line.qty + '</span><b>' + won(line.price * line.qty) + '</b></div>').join("")}<div class="row"><b>현재 메뉴 금액</b><strong>${won(quote.total)}</strong></div>
      ${quote.skipped.length ? '<p class="small muted">현재 없는 메뉴·품절 메뉴는 제외했어요. ' + quote.skipped.map(html).join(", ") + '</p>' : ""}${quote.priceChanged ? '<p class="small muted">이전 주문과 가격이 달라 현재 가격으로 표시했어요.</p>' : ""}${quote.note ? '<p class="small muted">함께 전달할 요청 · ' + html(quote.note) + '</p>' : ""}
      ${Object.keys(state.cart[quote.shop] ?? {}).length ? '<p class="small muted">이 매장에 담아 둔 메뉴를 위 구성으로 바꿔요.</p>' : ""}<p class="muted">담은 뒤 메뉴 화면에서 수량을 바꾸고 쿠폰을 확인해 픽업을 요청할 수 있어요.</p>${button("담고 메뉴 보기", "confirm-repeat-order", "wide")}`];
    }
    case "save-menu": return ["나의 메뉴로 저장", `<p class="muted">매장과 수량·요청사항을 함께 저장해요. 담을 때 현재 가격과 품절 상태를 다시 확인합니다.</p><form class="form" data-form="save-menu"><label>나의 메뉴 이름<input name="title" maxlength="24" required placeholder="예: 아침의 아메리카노" autocomplete="off"></label><button class="button" type="submit">저장하기</button></form>`];
    case "delete-menu": return ["저장한 메뉴를 삭제할까요?", '<p class="muted">기존 주문과 적립 내역은 그대로 보관돼요.</p>' + button("나의 메뉴 삭제", "delete-menu", "danger wide")];
    case "complete-pickup": {
      const order = state.overview.orders.find(entry => entry.id === dialog.id);
      return ["결제·쿠폰·픽업 확인", `<p><b>${html(order.name)} · ${html(order.couponTitle)}</b></p><p class="small muted">${order.lines.map(line => html(line.name) + ' × ' + line.qty).join(" · ")}</p>${checkoutPriceLines(order)}<form class="form" data-form="complete-pickup">
        ${order.couponType ? '<label>영수증 번호<input name="receiptNumber" required minlength="4" maxlength="64" placeholder="예: 20261119-0012" autocomplete="off"></label>' : ""}
        <label class="checkbox-label"><input name="purchaseConfirmed" type="checkbox" required>메뉴 제공과 표시된 매장 결제를 확인했습니다</label>
        ${order.couponType === "first" ? '<label class="checkbox-label"><input name="firstVisitConfirmed" type="checkbox" required>매장 기준 첫 방문 고객임을 확인했습니다</label>' : ""}
        <p class="small muted">확인하면 쿠폰 사용과 픽업 완료를 함께 기록하고 유상 음료를 적립해요.</p><button class="button" type="submit">결제·쿠폰 사용·픽업 완료</button></form>`];
    }
    case "campaign": return [state.campaignDraft ? "캠페인 수정" : "새 캠페인", campaignForm(state)];
    case "claim-campaign": {
      const campaign = campaignsFor(state).find(entry => entry.id === dialog.id);
      if (!campaign) return ["혜택 안내", '<p>혜택이 종료됐어요. 화면을 새로고침해 주세요.</p>'];
      return [campaign.title, `<p>${html(campaign.itemName)} · ${won(campaign.discountAmount)} 혜택</p><p class="muted">할인 전 ${won(campaign.minPurchase)} 이상 구매, 1인 1회. ${dateTime.format(campaign.endsAt)}까지 매장에서 사용하세요.</p>${benefitSchedule(campaign) ? '<p class="status">' + benefitSchedule(campaign) + '</p>' : ''}${campaign.description ? '<p>' + html(campaign.description) + '</p>' : ""}<form class="form" data-form="claim-campaign">${campaign.type === "sponsor" ? '<label>기관 참여 코드<input name="code" required maxlength="20" autocomplete="off" autocapitalize="characters"></label>' : ""}<button class="button" type="submit">혜택 쿠폰 받기</button></form>`];
    }
    case "end-campaign": return ["쿠폰 발급을 종료할까요?", `<p class="muted">이미 발급된 쿠폰은 표시된 유효기간까지 사용할 수 있어요.</p>${button("발급 종료 확인", "confirm-end-campaign", "wide")}`];
    case "redeem": {
      const selected = state.found?.coupons.find(entry => entry.id === dialog.id);
      if (selected?.kind !== "campaign") return ["쿠폰을 사용할까요?", `<p class="muted">고객과 메뉴를 확인한 뒤 승인하세요.</p>${button("쿠폰 사용 승인", "redeem", "wide")}`];
      return ["혜택 사용·구매 확인", `<p><b>${html(selected.title)}</b></p><p class="muted">${couponTerms(selected)}</p><p class="small muted">대상 음료의 할인 후 금액은 ${won(selected.price - selected.discountAmount)}입니다.${selected.price > selected.discountAmount && shopById(selected.shop).menu[selected.item][2] !== "food" ? " 사용 승인과 함께 음료 1잔이 적립돼요." : ""}</p>
        <form class="form" data-form="redeem-campaign"><label>영수증 번호<input name="receiptNumber" required minlength="4" maxlength="64" placeholder="예: 20261119-0012" autocomplete="off"></label>
        <label>할인 전 구매금액<input name="purchaseAmount" type="number" required min="${selected.minPurchase}" value="${selected.minPurchase}"></label>
        <label class="checkbox-label"><input name="purchaseConfirmed" type="checkbox" required>대상 메뉴 제공과 실제 영수증을 확인했습니다</label>${selected.campaignType === "first" ? '<label class="checkbox-label"><input name="firstVisitConfirmed" type="checkbox" required>매장 기준 첫 방문 고객임을 확인했습니다</label>' : ""}<button class="button" type="submit">구매 확인·혜택 사용 승인</button></form>`];
    }
    case "reverse": return ["적립을 취소할까요?", `<p class="muted">이 거래의 스탬프와 발행된 쿠폰이 회수돼요.</p>${button("적립 취소 승인", "reverse", "danger wide")}`];
    case "cancel-order": return ["픽업 요청을 취소할까요?", button("주문 취소", "cancel-order", "danger wide")];
    default: return ["", ""];
  }
}
