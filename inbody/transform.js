const numberOrNull = (value) => {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function toMetrics(data) {
  return {
    smm: numberOrNull(data.SMM),
    bfm: numberOrNull(data.BFM),
    pbf: numberOrNull(data.PBF),
    vfaLevel: numberOrNull(data.VFALevel),
    bmr: numberOrNull(data.BMR),
  };
}

export const digits = (value) => String(value ?? "").replace(/\D/g, "");

export function maskPhone(value) {
  const phone = digits(value);
  return phone.length < 4
    ? "****"
    : `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}
