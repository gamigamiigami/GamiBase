import { storefront } from "./storefront.mjs";
storefront()
  .then((site) => {
    if (!site) return;
    document.querySelectorAll("[data-checkout]").forEach((link) => {
      link.href = new URL("checkout.html", site);
    });
    document.querySelectorAll("[data-app-login]").forEach((link) => {
      link.href = new URL("app/", site);
    });
    document.getElementById("commerce-status").textContent =
      "特別クーポンは、取得画面で適用できます。通常購入は公式LINEで購入方法をご案内します。";
  })
  .catch(() => {
    document.getElementById("commerce-status").textContent =
      "取得受付の状況は次の画面でご確認ください。";
  });
const preview = document.getElementById("preview-dialog");
document.querySelectorAll("[data-preview]").forEach((button) => {
  button.addEventListener("click", () => preview.showModal());
});
document
  .getElementById("close-preview")
  .addEventListener("click", () => preview.close());
preview.addEventListener("click", (event) => {
  const bounds = preview.getBoundingClientRect();
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    preview.close();
});
