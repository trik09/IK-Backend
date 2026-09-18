# QCFY Backend - Puzzle Rating System Test Cases

This document defines the backend test cases, API specifications, mathematical formulas, and database validation flows for the **Chess Tactics & Puzzle Rating System** (`Qcfy-BackEnd`).

---

## Architecture & Schema Reference

### 1. User Model (`models/UserSchema.js`)
```javascript
{
  puzzleRating: { type: Number, default: null },
  puzzleInitialLevelSet: { type: Boolean, default: false },
  puzzlePuzzlesAttempted: { type: Number, default: 0 },
  puzzlePuzzlesSolved: { type: Number, default: 0 }
}
```

### 2. Puzzle Model (`models/PuzzleModel.js`)
```javascript
{
  fen: { type: String, required: true },
  solutionMoves: { type: [String], required: true },
  rating: { type: Number, default: 800 },
  level: { type: Number, default: 1 },
  theme: { type: String, default: "Tactics" }
}
```

### 3. Puzzle History Model (`models/PuzzleHistoryModel.js`)
```javascript
{
  puzzleId: { type: ObjectId, ref: 'Puzzle' },
  userId: { type: ObjectId, ref: 'User' },
  isSolved: { type: Boolean, default: false },
  timeTaken: { type: Number, default: 0 }
}
```

### 4. Primary API Endpoints
- `POST /api/puzzles/qcfy/initial-rating`: Sets user starting calibration level (400, 1000, 1600).
- `POST /api/puzzles/qcfy/result`: Updates rating using Glicko/Elo formula with dynamic K-factor.
- `GET /api/puzzles/qcfy/adaptive`: Returns an adaptive puzzle matched to user rating and difficulty tier.
- `GET /api/notifications`: Retrieves broadcast feature announcements.

---

## Test Cases Index

1. [TC-BE-01: Feature Notification Broadcast & Initial Rating Calibration](#tc-be-01-feature-notification-broadcast--initial-rating-calibration)
2. [TC-BE-02: Zero Rating Mutation Across Exam & Tournament Endpoints](#tc-be-02-zero-rating-mutation-across-exam--tournament-endpoints)
3. [TC-BE-03: Mathematical Elo/Glicko Rating Calculation & Delta Formulas](#tc-be-03-mathematical-eloglicko-rating-calculation--delta-formulas)
4. [TC-BE-04: Database Immutability & Rating Persistence Guarantees](#tc-be-04-database-immutability--rating-persistence-guarantees)
5. [TC-BE-05: Provisional Rating K-Factor Schedule & Phase Transition](#tc-be-05-provisional-rating-k-factor-schedule--phase-transition)

---

## Detailed Test Cases

### TC-BE-01: Feature Notification Broadcast & Initial Rating Calibration

#### Objective
Verify that admins can broadcast the new puzzle arena feature notification to all users and that users can calibrate their initial rating securely through the backend.

#### API Details
- **Endpoint**: `POST /api/puzzles/qcfy/initial-rating`
- **Auth**: Bearer JWT (Required)
- **Controller**: `controllers/puzzle.controller.js` -> `setInitialPuzzleRating`

#### Request Payload
```json
{
  "level": "intermediate"
}
```
*(Accepts `"beginner"`, `"intermediate"`, `"advanced"`, or numeric rating between `100` and `3000`).*

#### Business Logic & Verification Steps
1. **Level Mapping**:
   - `beginner` -> `400`
   - `intermediate` -> `1000`
   - `advanced` -> `1600`
2. **Database Update**:
   ```javascript
   await User.findByIdAndUpdate(userId, {
     $set: {
       puzzleRating: 1000,
       puzzleInitialLevelSet: true,
       puzzlePuzzlesAttempted: 0,
       puzzlePuzzlesSolved: 0
     }
   });
   ```
3. **Cache Invalidation**:
   - Verifies `invalidateAuthUserCache(userId)` is invoked to purge stale cached user tokens.
4. **Expected HTTP Response (200 OK)**:
   ```json
   {
     "success": true,
     "message": "Initial rating set to 1000",
     "user": {
       "_id": "664fa1...",
       "puzzleRating": 1000,
       "puzzleInitialLevelSet": true,
       "puzzlePuzzlesAttempted": 0,
       "puzzlePuzzlesSolved": 0
     }
   }
   ```
5. **Notification Broadcast (`POST /api/notifications/admin/create`)**:
   - Admin creates a notification with `{ title: "New Feature: QCFY Puzzle Arena", description: "Solve adaptive tactics puzzles and climb the tactics rating ladder!", link: "/qcfy-puzzles", ctaText: "Try Now" }`.
   - Calling `GET /api/notifications` returns the notification for all users with `unreadCount` tracking.

---

### TC-BE-02: Zero Rating Mutation Across Exam & Tournament Endpoints

#### Objective
Ensure that no exam, tournament, quiz, or homework endpoint in the entire backend mutates or has access to the user's `puzzleRating` or `puzzlePuzzlesAttempted` fields.

#### Endpoints Audited
- `POST /api/exams/submit` (`controllers/exam.controller.js`)
- `POST /api/competitions/submit` (`controllers/competition.controller.js`)
- `POST /api/quizzes/submit` (`controllers/quiz.controller.js`)

#### Verification Steps
1. Inspect MongoDB user document prior to test:
   ```javascript
   const beforeUser = await User.findById(userId).select('puzzleRating puzzlePuzzlesAttempted');
   // Expected: { puzzleRating: 1000, puzzlePuzzlesAttempted: 4 }
   ```
2. Execute an exam submission request:
   ```bash
   POST /api/exams/submit-answers
   Content-Type: application/json
   Authorization: Bearer <JWT>

   {
     "examId": "667a9b...",
     "answers": [{ "questionId": "q1", "selectedOption": "B" }],
     "timeSpent": 320
   }
   ```
3. Inspect MongoDB user document after exam completion:
   ```javascript
   const afterUser = await User.findById(userId).select('puzzleRating puzzlePuzzlesAttempted');
   ```
4. **Assertion**:
   - `afterUser.puzzleRating === beforeUser.puzzleRating` (STRICT EQUALITY).
   - `afterUser.puzzlePuzzlesAttempted === beforeUser.puzzlePuzzlesAttempted`.
   - `UserSchema` fields `puzzleRating`, `puzzleInitialLevelSet`, `puzzlePuzzlesAttempted`, and `puzzlePuzzlesSolved` are never present in any update query inside `exam.controller.js`.

---

### TC-BE-03: Mathematical Elo/Glicko Rating Calculation & Delta Formulas

#### Objective
Validate the mathematical precision of rating changes upon puzzle outcomes, ensuring appropriate risk/reward scaling based on the rating difference between the player and the puzzle.

#### API Details
- **Endpoint**: `POST /api/puzzles/qcfy/result`
- **Auth**: Bearer JWT (Required)
- **Controller**: `controllers/puzzle.controller.js` -> `updateQcfyRating`

#### Mathematical Formulas Implemented
1. **Expected Score ($E$)**:
   $$E = \frac{1}{1 + 10^{(R_{\text{puzzle}} - R_{\text{user}}) / 400}}$$
2. **Actual Score ($S$)**:
   - $S = 1$ if `outcome === "solved"`
   - $S = 0$ if `outcome === "failed"`
3. **Rating Delta ($\Delta$)**:
   $$\Delta = \text{round}(K \times (S - E))$$
4. **Movement Guarantees**:
   - Win minimum: $\Delta = \max(2, \Delta)$
   - Loss minimum: $\Delta = \min(-2, \Delta)$
   - Floor: $R_{\text{new}} = \max(100, R_{\text{user}} + \Delta)$

#### Test Scenarios & Expectations

| Scenario | User Rating | Puzzle Rating | Outcome | K-Factor | Expected Score ($E$) | Expected Delta ($\Delta$) | New Rating |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Even Match Win** | 1000 | 1000 | `solved` | 20 | 0.50 | $+10$ | 1010 |
| **Even Match Loss** | 1000 | 1000 | `failed` | 20 | 0.50 | $-10$ | 990 |
| **Hard Puzzle Win** | 1000 | 1300 | `solved` | 20 | 0.15 | $+17$ | 1017 |
| **Hard Puzzle Loss**| 1000 | 1300 | `failed` | 20 | 0.15 | $-3$ | 997 |
| **Easy Puzzle Win** | 1000 | 700 | `solved` | 20 | 0.85 | $+3$ | 1003 |
| **Easy Puzzle Loss**| 1000 | 700 | `failed` | 20 | 0.85 | $-17$ | 983 |

#### Expected Response (200 OK)
```json
{
  "success": true,
  "delta": 17,
  "newRating": 1017,
  "puzzlesAttempted": 11,
  "isProvisional": false,
  "puzzlesSolved": 8
}
```

---

### TC-BE-04: Database Immutability & Rating Persistence Guarantees

#### Objective
Verify that a user's tactics rating in MongoDB is permanent, strictly preserved across server restarts, session expirations, and user reconnections, and cannot be reset to null or zero without explicit admin action.

#### Execution & Verification Steps
1. **Initial State**:
   - User `puzzleRating` is `1142`.
2. **Server Restart Simulation**:
   - Restart the Node.js backend server (`node index.js`).
   - Request user profile via `GET /api/users/profile`.
   - Verify `res.body.user.puzzleRating === 1142`.
3. **Session Invalidation**:
   - Invalidate all JWT tokens / user sessions.
   - User logs in fresh with credentials (`POST /api/users/login`).
   - Query DB directly via Mongoose:
     ```javascript
     const dbUser = await User.findById(userId);
     expect(dbUser.puzzleRating).toBe(1142);
     ```
4. **Unrated Result Guard**:
   - If an unrated puzzle is played, the frontend does not send requests to `POST /api/puzzles/qcfy/result`.
   - Verify zero database write queries occur.
5. **Puzzle History Audit Trail**:
   - Each completed rated puzzle inserts a persistent audit record in `PuzzleHistoryModel`:
     ```javascript
     {
       puzzleId: puzzle._id,
       userId: user._id,
       isSolved: true,
       timeTaken: 14
     }
     ```
   - Enables historical verification and prevents score tampering.

---

### TC-BE-05: Provisional Rating K-Factor Schedule & Phase Transition

#### Objective
Confirm that the K-factor dynamically decays during the provisional phase (first 10 puzzles) to allow quick rating discovery, and stabilizes at $K=20$ starting at attempt 10.

#### K-Factor Mathematical Schedule
$$\text{For } \text{attempts} < 10: \quad K = 40 + (10 - \text{attempts}) \times 2$$
$$\text{For } \text{attempts} \ge 10: \quad K = 20$$

#### Step-by-Step Schedule Verification

| Attempt Number | Current `attempts` in DB | Computed K-Factor | Status Returned |
| :--- | :--- | :--- | :--- |
| **Puzzle 1** | 0 | $40 + (10 - 0) \times 2 = \mathbf{60}$ | `isProvisional: true` |
| **Puzzle 2** | 1 | $40 + (10 - 1) \times 2 = \mathbf{58}$ | `isProvisional: true` |
| **Puzzle 5** | 4 | $40 + (10 - 4) \times 2 = \mathbf{52}$ | `isProvisional: true` |
| **Puzzle 9** | 8 | $40 + (10 - 8) \times 2 = \mathbf{44}$ | `isProvisional: true` |
| **Puzzle 10** | 9 | $40 + (10 - 9) \times 2 = \mathbf{42}$ | `isProvisional: true` |
| **Puzzle 11** | 10 | $\mathbf{20}$ (Established) | `isProvisional: false` |
| **Puzzle 12+**| 11+ | $\mathbf{20}$ (Established) | `isProvisional: false` |

#### Expected Response on 10th Attempt Completion
```json
{
  "success": true,
  "delta": 21,
  "newRating": 1185,
  "puzzlesAttempted": 10,
  "isProvisional": false,
  "puzzlesSolved": 7
}
```

#### Verification Assertion
- When `puzzlesAttempted` transitions from `9` to `10`, the response payload sets `isProvisional: false`.
- The database now permanently registers the player as an established tactical player.
