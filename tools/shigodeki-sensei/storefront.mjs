// Pages sends purchasers to the HTTPS app server. No accounts are created on Pages.
export async function storefront() {
  const response = await fetch(
    new URL("commerce-config.json", import.meta.url),
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("公開設定を読み込めませんでした。");
  const { appOrigin } = await response.json();
  if (!appOrigin) return null;
  const origin = new URL(appOrigin);
  if (
    origin.origin !== appOrigin ||
    origin.username ||
    origin.password ||
    (origin.protocol !== "https:" &&
      !(
        origin.origin === location.origin &&
        ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
      ))
  )
    throw new Error("アプリの公開URLを確認できません。");
  return new URL("/tools/shigodeki-sensei/", origin);
}
