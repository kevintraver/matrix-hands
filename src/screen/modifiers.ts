/**
 * Per-screen hook between the shared hand texture and each screen. Every screen shows the same hand
 * today; a jitter or delay effect replaces `screenModifier` without touching the screens.
 */
export type ScreenModification = { readonly offset: readonly [number, number]; readonly gain: number };

export type ScreenModifier = (index: number, t: number) => ScreenModification;

const IDENTITY: ScreenModification = { offset: [0, 0], gain: 1 };

export const identityModifier: ScreenModifier = () => IDENTITY;

export const screenModifier: ScreenModifier = identityModifier;
