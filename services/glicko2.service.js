/**
 * Glicko-2 Rating System Implementation
 * Based on Mark E. Glickman's Glicko-2 system specifications.
 * 
 * Used across QCFY to calculate dynamic rating, rating deviation (RD),
 * and volatility for both chess players and chess puzzles.
 */

const GLICKO_SCALE = 173.7178;
const DEFAULT_TAU = 0.5; // System constant governing volatility change rate
const EPSILON = 0.000001; // Convergence tolerance for numerical root-finding

/**
 * Converts rating from standard scale to Glicko-2 scale (mu)
 */
export const ratingToMu = (rating) => (rating - 1500) / GLICKO_SCALE;

/**
 * Converts rating from Glicko-2 scale (mu) back to standard scale
 */
export const muToRating = (mu) => 1500 + mu * GLICKO_SCALE;

/**
 * Converts RD from standard scale to Glicko-2 scale (phi)
 */
export const rdToPhi = (rd) => rd / GLICKO_SCALE;

/**
 * Converts RD from Glicko-2 scale (phi) back to standard scale
 */
export const phiToRd = (phi) => phi * GLICKO_SCALE;

/**
 * Helper function g(phi) to scale the weight of opponent's uncertainty
 */
export const g = (phi) => 1 / Math.sqrt(1 + (3 * Math.pow(phi, 2)) / Math.pow(Math.PI, 2));

/**
 * Expected score function E(mu, mu_j, phi_j)
 */
export const expectedScore = (mu, mu_j, phi_j) => {
  const g_phi = g(phi_j);
  return 1 / (1 + Math.exp(-g_phi * (mu - mu_j)));
};

/**
 * Calculates new Glicko-2 rating, RD, and volatility for a single match or puzzle attempt
 * 
 * @param {Object} player - { rating, rd, volatility }
 * @param {Object} opponent - { rating, rd, volatility }
 * @param {number} score - 1 for win (solved), 0 for loss (failed), 0.5 for draw
 * @param {number} tau - System constant (default: 0.5)
 * @returns {Object} { rating, rd, volatility, ratingChange, rdChange, expectedOutcome }
 */
export const calculateGlicko2 = (
  player = { rating: 400, rd: 350, volatility: 0.06 },
  opponent = { rating: 1000, rd: 350, volatility: 0.06 },
  score = 1,
  tau = DEFAULT_TAU
) => {
  // 1. Convert to Glicko-2 scale
  const mu = ratingToMu(player.rating || 400);
  const phi = rdToPhi(player.rd || 350);
  const sigma = player.volatility || 0.06;

  const mu_j = ratingToMu(opponent.rating || 1000);
  const phi_j = rdToPhi(opponent.rd || 350);

  // 2. Compute variance v and expected score E
  const E = expectedScore(mu, mu_j, phi_j);
  const g_phi = g(phi_j);
  const v = 1 / (Math.pow(g_phi, 2) * E * (1 - E));

  // 3. Compute estimated improvement Delta
  const delta = v * g_phi * (score - E);

  // 4. Determine new volatility sigma_prime using Illinois algorithm
  const a = Math.log(Math.pow(sigma, 2));
  
  const f = (x) => {
    const e_x = Math.exp(x);
    const num = e_x * (Math.pow(delta, 2) - Math.pow(phi, 2) - v - e_x);
    const denom = 2 * Math.pow(Math.pow(phi, 2) + v + e_x, 2);
    return (num / denom) - ((x - a) / Math.pow(tau, 2));
  };

  let A = a;
  let B;
  if (Math.pow(delta, 2) > Math.pow(phi, 2) + v) {
    B = Math.log(Math.pow(delta, 2) - Math.pow(phi, 2) - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) {
      k += 1;
    }
    B = a - k * tau;
  }

  let f_A = f(A);
  let f_B = f(B);

  while (Math.abs(B - A) > EPSILON) {
    const C = A + ((A - B) * f_A) / (f_B - f_A);
    const f_C = f(C);

    if (f_C * f_B < 0) {
      A = B;
      f_A = f_B;
    } else {
      f_A = f_A / 2;
    }
    B = C;
    f_B = f_C;
  }

  const sigma_prime = Math.exp(A / 2);

  // 5. Update pre-rating deviation phi_star
  const phi_star = Math.sqrt(Math.pow(phi, 2) + Math.pow(sigma_prime, 2));

  // 6. Compute new rating deviation phi_prime and new rating mu_prime
  const phi_prime = 1 / Math.sqrt((1 / Math.pow(phi_star, 2)) + (1 / v));
  const mu_prime = mu + Math.pow(phi_prime, 2) * g_phi * (score - E);

  // 7. Convert back to standard scale
  let newRating = Math.round(muToRating(mu_prime));
  let newRd = Math.round(phiToRd(phi_prime));

  // Enforce platform constraints:
  // Minimum rating floor is 100
  newRating = Math.max(100, newRating);
  // RD is clamped between 30 (highly certain) and 350 (unrated / provisional)
  newRd = Math.max(30, Math.min(350, newRd));

  const ratingChange = newRating - (player.rating || 400);
  const rdChange = newRd - (player.rd || 350);

  return {
    rating: newRating,
    rd: newRd,
    volatility: Number(sigma_prime.toFixed(6)),
    ratingChange,
    rdChange,
    expectedOutcome: Number(E.toFixed(4)),
    userRatingBefore: player.rating || 400,
    userRDBefore: player.rd || 350,
  };
};

/**
 * Computes dual Glicko-2 updates for both user and puzzle simultaneously
 */
export const calculateDualGlicko2 = (
  user = { rating: 400, rd: 350, volatility: 0.06 },
  puzzle = { rating: 1000, rd: 350, volatility: 0.06 },
  isSolved = true
) => {
  const userScore = isSolved ? 1 : 0;
  const puzzleScore = isSolved ? 0 : 1;

  const userResult = calculateGlicko2(user, puzzle, userScore);
  const puzzleResult = calculateGlicko2(puzzle, user, puzzleScore);

  return {
    user: userResult,
    puzzle: puzzleResult
  };
};
