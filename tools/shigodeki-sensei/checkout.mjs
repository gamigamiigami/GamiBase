import { storefront } from "./storefront.mjs";
const $ = (id) => document.getElementById(id);
let quote,
  timer,
  submitting = false,
  applying = false;
const yen = (amount) => `${amount.toLocaleString("ja-JP")}円`;
async function api(route, data) {
  let response;
  try {
    response = await fetch(`/api/shigodeki/${route}`, {
      method: data ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
    });
  } catch {
    throw new Error(
      "通信できませんでした。接続を確認して、もう一度お試しください。",
    );
  }
  if (
    !(response.headers.get("Content-Type") || "").includes("application/json")
  )
    throw new Error("アプリの受付を確認できませんでした。");
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(result.error || "操作を完了できませんでした。"),
      { status: response.status },
    );
  return result;
}
function resetQuote() {
  clearTimeout(timer);
  quote = null;
  $("quote").hidden = $("registration").hidden = true;
  $("paid-option").hidden = false;
  $("register-error").textContent = "";
}
function complete(result) {
  clearTimeout(timer);
  quote = null;
  $("checkout").hidden = true;
  $("complete").hidden = false;
  $("complete-email").textContent =
    `${result.user.email} のアカウントで利用できます。`;
  $("receipt").textContent = result.order
    ? `取得完了 · お支払い額 ${yen(result.order.total)} · 注文番号 ${result.order.id}`
    : "登録済みの利用権限を確認しました。";
  // Fixed local app path: never navigate to a URL supplied by a form or query string.
  $("open-app").href = "app/";
  $("complete").focus();
}
async function init() {
  $("loading").hidden = false;
  $("unavailable").hidden = true;
  try {
    const site = await storefront();
    if (!site)
      throw new Error("公開開始後に、こちらから取得できるようになります。");
    if (site.origin !== location.origin) {
      location.replace(new URL("checkout.html", site));
      return;
    }
    const product = await api("product");
    $("coupon-form").hidden = !product.couponAvailable;
    $("checkout").hidden = false;
    try {
      complete(await api("access"));
    } catch (error) {
      if (error.status !== 401) throw error;
    }
  } catch (error) {
    $("checkout").hidden = true;
    $("unavailable").hidden = false;
    $("unavailable-reason").textContent = error.message;
  } finally {
    $("loading").hidden = true;
  }
}
$("retry").onclick = init;
$("coupon").addEventListener("input", () => {
  if (submitting || applying) return;
  resetQuote();
  $("coupon-error").textContent = "";
});
$("remove-coupon").onclick = () => {
  resetQuote();
  $("coupon").value = "";
  $("coupon").focus();
};
$("coupon-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submitting || applying) return;
  resetQuote();
  const code = $("coupon").value.trim();
  $("apply-coupon").disabled = true;
  applying = true;
  $("coupon-error").textContent = "";
  try {
    const result = await api("quote", { coupon: code });
    if ($("coupon").value.trim() !== code) return;
    if (result.total !== 0) throw new Error("無料取得の対象ではありません。");
    quote = result;
    $("coupon-discount").textContent = `−${yen(result.couponDiscount)}`;
    $("total").textContent = yen(result.total);
    $("quote-expiry").textContent =
      "適用から15分以内に取得を完了してください。";
    $("quote").hidden = $("registration").hidden = false;
    $("paid-option").hidden = true;
    timer = setTimeout(
      () => {
        if (!submitting) {
          resetQuote();
          $("coupon-error").textContent =
            "有効期限が切れました。クーポンをもう一度適用してください。";
        }
      },
      Math.max(0, result.expires - Date.now()),
    );
  } catch (error) {
    $("coupon-error").textContent = error.message;
  } finally {
    $("apply-coupon").disabled = false;
    applying = false;
  }
});
$("register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submitting) return;
  if (!quote || Date.now() >= quote.expires) {
    resetQuote();
    $("coupon-error").textContent = "クーポンをもう一度適用してください。";
    return;
  }
  if ($("buyer-password").value !== $("password-confirm").value) {
    $("register-error").textContent = "確認用のパスワードが一致しません。";
    return;
  }
  submitting = true;
  const controls = [
    $("get-app"),
    $("remove-coupon"),
    $("apply-coupon"),
    $("coupon"),
    $("buyer-email"),
    $("buyer-password"),
    $("password-confirm"),
  ];
  controls.forEach((control) => {
    control.disabled = true;
  });
  $("register-error").textContent = "";
  try {
    const result = await api("checkout/free", {
      quoteId: quote.quoteId,
      email: $("buyer-email").value,
      password: $("buyer-password").value,
    });
    complete(result);
    $("buyer-password").value = $("password-confirm").value = "";
  } catch (error) {
    // A response can be lost after the transaction committed. Recover from the authenticated session.
    try {
      complete(await api("access"));
      $("buyer-password").value = $("password-confirm").value = "";
    } catch {
      $("register-error").textContent = error.message;
    }
  } finally {
    submitting = false;
    controls.forEach((control) => {
      control.disabled = false;
    });
  }
});
init();
