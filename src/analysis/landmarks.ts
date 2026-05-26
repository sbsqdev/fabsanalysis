/**
 * MediaPipe Face Mesh 478-point landmark index constants.
 * Reference: https://github.com/google/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model_uv_visualization.png
 */

// ─── Eye landmarks ───────────────────────────────────────────────────────────

// Right eye (from viewer's perspective = subject's left eye)
export const RIGHT_EYE = {
  inner: 133,
  outer: 33,
  // Upper/lower lid points tuned for aperture estimation.
  top: [160, 159, 158],
  bottom: [144, 145, 153],
  // For EAR calculation (Soukupova 6-point formula)
  p1: 33,   // lateral canthus
  p2: 160,  // top-medial
  p3: 158,  // top-lateral
  p4: 133,  // medial canthus
  p5: 153,  // bottom-lateral
  p6: 144,  // bottom-medial
  // Third vertical pair (centre) for full 3-pair Soukupova formula
  p_top_centre: 159,  // top-centre
  p_bot_centre: 145,  // bottom-centre
} as const;

// Left eye
export const LEFT_EYE = {
  inner: 362,
  outer: 263,
  top: [385, 386, 387],
  bottom: [373, 374, 380],
  p1: 263,
  p2: 385,
  p3: 387,
  p4: 362,
  p5: 373,
  p6: 380,
  // Third vertical pair (centre) for full 3-pair Soukupova formula
  p_top_centre: 386,  // top-centre
  p_bot_centre: 374,  // bottom-centre
} as const;

// Iris landmarks (MediaPipe 468-477)
export const RIGHT_IRIS_CENTER = 468;
export const LEFT_IRIS_CENTER = 473;

// ─── Eyebrow landmarks ──────────────────────────────────────────────────────

export const RIGHT_EYEBROW = [70, 63, 105, 66, 107] as const;
export const LEFT_EYEBROW = [300, 293, 334, 296, 336] as const;

// Extended eyebrow contours for mask generation (upper + lower edges)
export const RIGHT_EYEBROW_UPPER = [70, 63, 105, 66, 107] as const;
export const RIGHT_EYEBROW_LOWER = [46, 53, 52, 65, 55] as const;
export const LEFT_EYEBROW_UPPER = [300, 293, 334, 296, 336] as const;
export const LEFT_EYEBROW_LOWER = [276, 283, 282, 295, 285] as const;

// ─── Nose landmarks ─────────────────────────────────────────────────────────

export const NOSE = {
  tip: 1,
  bridge: 168, // nasion root (frontonasal junction) — was 6 (rhinion mid-dorsum, ~20-25% shorter)
  rightAlar: 129,
  leftAlar: 358,
  bottom: 2,
  rightNostril: 98,
  leftNostril: 327,
} as const;

// ─── Lip landmarks ──────────────────────────────────────────────────────────

export const LIPS = {
  upperCenter: 13,
  lowerCenter: 14,
  rightCorner: 61,
  leftCorner: 291,
  upperOuter: 0,
  lowerOuter: 17,
  // Upper lip top contour
  upperTop: [37, 0, 267],
  // Upper lip bottom contour (vermilion border)
  upperBottom: [82, 13, 312],
  // Lower lip top contour
  lowerTop: [87, 14, 317],
  // Lower lip bottom contour (canonical outer vermilion points)
  lowerBottom: [84, 17, 314],
} as const;

// Full outer lip contours for mask generation (dense 11-point contours)
// Upper outer: from right corner → over the upper lip bow → to left corner
export const LIPS_OUTER_UPPER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291] as const;
// Lower outer: from right corner → under the lower lip → to left corner
export const LIPS_OUTER_LOWER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291] as const;

// Lower face contour for chin/jaw mask (right jaw mid-point → chin bottom → left jaw mid-point)
export const CHIN_LOWER_CONTOUR = [58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397] as const;

// ─── Jaw landmarks ──────────────────────────────────────────────────────────

export const JAW = {
  rightAngle: 234,
  leftAngle: 454,
  // Lower jaw body points (closer to bigonial width proxy than lateral face extremes)
  rightBody: 172,
  leftBody: 397,
  // Full jawline contour (right to left)
  contour: [234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454],
} as const;

// ─── Chin ────────────────────────────────────────────────────────────────────

export const CHIN = {
  tip: 152,
  left: 377,
  right: 148,
} as const;

// ─── Face contour / silhouette ──────────────────────────────────────────────

export const FACE_CONTOUR = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365,
  379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93,
  234, 127, 162, 21, 54, 103, 67, 109,
] as const;

// ─── Forehead / top of face ─────────────────────────────────────────────────

export const FOREHEAD = {
  center: 10,
  // Lateral upper-face points (closer to frontotemporal width than 109/338).
  right: 127,
  left: 356,
} as const;

// ─── Cheek regions (approximate centers) ────────────────────────────────────

export const CHEEKS = {
  rightCenter: 187,
  leftCenter: 411,
  rightOuter: 123,
  leftOuter: 352,
} as const;

// ─── Ear approximation (face mesh doesn't cover ears well) ──────────────────
// These are the outermost lateral face points, near the ear region
export const EAR_REGION = {
  rightTragus: 234,  // approximate
  leftTragus: 454,   // approximate
} as const;

// ─── Key reference distances ────────────────────────────────────────────────

export const REFERENCE = {
  // Top of face to chin - vertical face height
  faceTop: 10,
  faceBottom: 152,
  // Interpupillary distance reference points
  rightPupil: 468, // iris center
  leftPupil: 473,  // iris center
  // Face width at cheekbones
  rightCheekbone: 234,
  leftCheekbone: 454,
} as const;

// Dedicated zygomatic references for proportion metrics (bizygomatic proxy).
export const ZYGION = {
  right: CHEEKS.rightOuter,
  left: CHEEKS.leftOuter,
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// DENSE / CANDIDATE SETS — for soft-tissue profile analysis & robust centroid
// ═════════════════════════════════════════════════════════════════════════════

// ─── Glabella & Nasion ─────────────────────────────────────────────────────
// Glabella: smooth prominence between brows, above nasion.
// 9 = mid-forehead between brows, 8 = slightly lower.
// Removed lm[168] (nasion region) — sharing it with NASION_CANDIDATES
// caused the glabella centroid to collapse toward nasion in profile photos.
export const GLABELLA_CANDIDATES = [9, 8] as const;

// Nasion: deepest point of the frontonasal suture; approximated by the
// bridge root only. lm[168] = frontonasal junction (most anatomically correct).
// Removed lm[6] (rhinion/mid-dorsum) — it is 20-25% down the dorsum, pulling
// the nasion centroid inferiorly and inflating the computed nasofrontal angle.
export const NASION_CANDIDATES = [168] as const;

// ─── Nose dorsum & tip ─────────────────────────────────────────────────────
// Dorsum: midline points from bridge to tip, useful for profile projection.
// 6=bridge mid, 197=upper dorsum, 195=mid-dorsum, 5=lower dorsum, 4=pre-tip.
export const NOSE_DORSUM_DENSE = [6, 197, 195, 5, 4] as const;

// Tip / pronasale: the most anterior point of the nose on profile.
// 1=canonical tip, 2=bottom reference, 98/327=nostril flanks for median.
export const NOSE_TIP_DENSE = [1, 2, 98, 327] as const;

// ─── Columella & Subnasale ─────────────────────────────────────────────────
// Columella: the fleshy column between the nostrils, best visible in profile.
// 2=nose base center, 98/327=nostril base margins.
export const COLUMELLA_CANDIDATES = [2, 98, 327] as const;

// Subnasale: junction of columella and upper lip in the midline.
// Avoid reusing point 2 here to prevent cm/sn collapse in derived ratios.
// Index 0 (LIPS.upperOuter) intentionally excluded — it is also assigned to
// labiale_superius in the profile sparse array, so including it here would
// contaminate the subnasale centroid with the lip point (~5-8% face height below sn).
export const SUBNASALE_CANDIDATES = [164, 167] as const;

// ─── Philtrum ──────────────────────────────────────────────────────────────
// Vertical groove from subnasale to vermilion border.
// 164=philtrum top, 167/165=philtrum sides, 92/186=near vermilion border.
export const PHILTRUM_DENSE = [164, 167, 165, 92, 186] as const;

// ─── Lip vermilion (dense) ─────────────────────────────────────────────────
// Re-export existing dense contours with semantic alias for soft-tissue use.
export const UPPER_LIP_VERMILION_DENSE = LIPS_OUTER_UPPER;
export const LOWER_LIP_VERMILION_DENSE = LIPS_OUTER_LOWER;

// ─── Chin soft tissue ──────────────────────────────────────────────────────
// Midline chin points only: 152=menton/chin tip, 175=mentolabial sulcus, 18=below lower lip.
// Restricted to midline to avoid lateral mandible drift in pogonion estimation.
// Note: 175 and 18 may be absent in sparse MediaPipe arrays. robustMedian() guards with
// `if (!pt) continue`, so if absent the centroid silently degrades to lm[152] alone.
export const CHIN_SOFT_TISSUE_DENSE = [152, 175, 18] as const;

// ─── Dense jawline ─────────────────────────────────────────────────────────
// Already covered by JAW.contour (21 points). Alias for clarity.
export const JAWLINE_DENSE = JAW.contour;

// ─── Malar / zygomatic prominence ──────────────────────────────────────────
// Cheekbone region: center, outer edge, and intermediate points.
// Right side: 187=center, 123=outer, 117/118=infra-orbital, 101=lateral orbit.
export const MALAR_DENSE_RIGHT = [187, 123, 117, 118, 101] as const;
// Left side: symmetric counterparts.
export const MALAR_DENSE_LEFT = [411, 352, 346, 347, 330] as const;

// ─── Orbital rim ───────────────────────────────────────────────────────────
// Approximated by the eye contour points that sit closest to the bony rim.
// These combine outer, inner, top, and bottom eye landmarks.
export const ORBITAL_RIM_DENSE_RIGHT = [33, 133, 159, 158, 157, 154, 153, 145] as const;
export const ORBITAL_RIM_DENSE_LEFT = [263, 362, 386, 385, 384, 381, 380, 374] as const;

// ─── Forehead dense ────────────────────────────────────────────────────────
// Upper face region from FACE_CONTOUR top portion + center/sides.
// 10=top-center, 67/109=right mid-forehead, 103/54=right upper, 21/162=left upper, 127=right lateral.
export const FOREHEAD_DENSE = [10, 67, 109, 103, 54, 21, 162, 127] as const;

// ─── Mentolabial sulcus ────────────────────────────────────────────────────
// The crease between lower lip and chin. Approximated from lower lip bottom
// and chin tip landmarks.
// 17=lower lip bottom, 18=below lower lip, 175=mentolabial region, 152=chin tip.
export const MENTOLABIAL_CANDIDATES = [17, 18, 175, 152] as const;
