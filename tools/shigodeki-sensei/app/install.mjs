export function setupInstall() {
  const button = document.getElementById("install-button");
  const guide = document.getElementById("install-dialog");
  let prompt;
  function installed() {
    button.textContent = "ホーム画面に追加済み";
    button.disabled = true;
    prompt = null;
  }
  if (matchMedia("(display-mode: standalone)").matches || navigator.standalone)
    installed();
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    prompt = event;
    button.disabled = false;
  });
  window.addEventListener("appinstalled", installed);
  button.addEventListener("click", async () => {
    if (!prompt) {
      guide.showModal();
      return;
    }
    button.disabled = true;
    const available = prompt;
    prompt = null;
    try {
      await available.prompt();
      const result = await available.userChoice;
      if (result.outcome === "accepted") installed();
      else button.disabled = false;
    } catch {
      button.disabled = false;
      guide.showModal();
    }
  });
}
