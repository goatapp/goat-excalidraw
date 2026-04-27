(function () {
  if (typeof window.EXCALIDRAW_ASSET_PATH === "string" && window.EXCALIDRAW_ASSET_PATH.length > 0) return;
  window.EXCALIDRAW_ASSET_PATH = new URL("/", window.location.origin).toString();
})();
