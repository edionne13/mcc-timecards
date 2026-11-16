export const PAY_TYPES = ["regular", "vacation", "holiday", "sick"] as const;
export type PayType = (typeof PAY_TYPES)[number];
export const PAY_LABELS: Record<PayType, string> = {
  regular: "Regular hours worked",
  vacation: "Vacation pay",
  holiday: "Holiday pay",
  sick: "Sick pay",
};
export function payType(entry: { pay_type?: PayType }): PayType {
  return entry.pay_type ?? "regular";
}
