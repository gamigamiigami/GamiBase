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
