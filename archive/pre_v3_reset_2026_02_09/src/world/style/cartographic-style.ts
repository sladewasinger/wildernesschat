export type RoofPalette = {
  wall: string;
  roofLight: string;
  roofDark: string;
};

export type CartographicStyle = {
  sunDirection: { x: number; y: number };
  shadowOffset: { x: number; y: number };
  roofPalettes: RoofPalette[];
};

export const CARTOGRAPHIC_STYLE: CartographicStyle = {
  // Sun from upper-left, matching the reference look.
  sunDirection: { x: -0.82, y: -0.57 },
  shadowOffset: { x: 2.2, y: 2.8 },
  roofPalettes: [
    { wall: "#c3b59d", roofLight: "#a98b7a", roofDark: "#7f6357" },
    { wall: "#b7b8b0", roofLight: "#87919b", roofDark: "#646d76" },
    { wall: "#c2b19e", roofLight: "#a67963", roofDark: "#7f5848" },
    { wall: "#bbb09f", roofLight: "#958674", roofDark: "#6d6254" }
  ]
};
