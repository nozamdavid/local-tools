/** The Loconvert corner holds a dot, representing a file that stays put. */
export function LogoMark({ size = 30 }: { size?: number }) {
  return <img src={`${import.meta.env.BASE_URL}assets/icon.svg`} width={size} height={size} alt="" className="logo-mark" />;
}
