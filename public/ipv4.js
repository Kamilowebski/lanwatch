function isValidIPv4(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('.');
  return parts.length === 4 && parts.every(part => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255);
}
if (typeof module !== 'undefined' && module.exports) module.exports = { isValidIPv4 };
