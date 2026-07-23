function createStatusReporter() {
  function setDatasetValue(key, value) {
    const root = document.documentElement;
    if (!root) return;
    if (value) root.dataset[key] = String(value);
    else delete root.dataset[key];
  }

  function setWakeLockStatus(status, error) {
    setDatasetValue(WAKE_LOCK_DATA_ATTR, status);
    setDatasetValue(WAKE_LOCK_ERROR_ATTR, error ? String(error).slice(0, 160) : "");
  }

  function setGenerationStatus(status) {
    setDatasetValue(GENERATION_DATA_ATTR, status);
  }

  function setIosIconStatus(status) {
    const root = document.documentElement;
    if (!root) return;
    if (status) root.setAttribute(IOS_ICON_DATA_ATTR, status);
    else root.removeAttribute(IOS_ICON_DATA_ATTR);
  }

  return {
    setWakeLockStatus,
    setGenerationStatus,
    setIosIconStatus,
  };
}
