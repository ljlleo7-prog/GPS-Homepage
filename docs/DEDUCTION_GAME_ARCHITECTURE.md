# F1 Team Deduction Game - Architecture

## System Overview

Server-authoritative multiplayer social deduction game built on Supabase + React.

**Key Design Principles:**
- Server handles all secret state, RNG, and game logic
- Client handles UI, chat input, action selection
- Bots run server-side with custom logic (no LLM)
- Designed for 2-4 humans + bots (cold start optimization)

## Architecture Layers

### 1. Database Layer (Supabase Postgres)
- Stores all game state: rooms, players, races, actions, votes
- Provides realtime subscriptions for live updates
- Enforces data integrity via constraints and RLS

### 2. Server Layer (Supabase Edge Functions)
- `create-room`: Initialize room with settings
- `join-room`: Add player or bot to room
- `start-game`: Assign roles/alignments, generate season
- `submit-action`: Validate and store player action
- `resolve-round`: Process actions, run race simulation, update expulsion tracks
- `submit-vote`: Record vote
- `resolve-vote`: Tally votes, apply eliminations, check win conditions
- `bot-decide`: Generate bot actions and messages

### 3. Client Layer (React + Context)
- `DeductionGameContext`: Game state, realtime sync, action submission
- UI components: Lobby, GameRoom, RacePhase, Discussion, Voting, Results
- Optimistic UI updates where safe

### 4. Bot Engine (Server-side)
- Personality profiles with suspicion/trust tracking
- Utility-based action selection
- Template-driven phrase generation
- Context safety validation layer

## Data Flow

### Room Creation Flow
```
User clicks "Create Room" 
→ Client calls create-room function
→ Server generates room_id, settings, season_seed
→ Returns room_id
→ Client navigates to /deduction-game/:roomId
```

### Game Start Flow
```
Host clicks "Start Game"
→ Client calls start-game function
→ Server assigns roles (TP public, others secret)
→ Server assigns alignments based on negative count table
→ Server fills empty slots with bots
→ Server generates season rules (expulsion thresholds)
→ Updates room status to "in_progress"
→ All clients receive realtime update
```

### Round Flow
```
1. Server advances to "night_phase"
2. Clients show role action UI
3. Players submit actions via submit-action
4. Bots auto-submit via bot-decide
5. Timer expires or all actions submitted
6. Server calls resolve-round:
   - Apply TC protections/sabotages
   - Apply IS checks
   - Apply ST actions
   - Run race RNG (DNF, performance)
   - Update expulsion counters
   - Generate public race report
7. Server advances to "discussion"
8. Bots post messages via bot-decide
9. Timer expires, advance to "voting"
10. Players submit votes
11. Server calls resolve-vote:
    - Tally votes
    - Apply TP extra fire if applicable
    - Reveal fired players' alignments
    - Check win conditions
12. If game continues, advance to next round
```

## Security Model

**Server Authority:**
- Role assignments
- Alignment assignments
- Action resolution
- RNG seeds and outcomes
- Vote tallies
- Win condition checks

**Client Trust:**
- UI rendering
- Chat display
- Timer display
- Action selection (validated server-side)

**RLS Policies:**
- Players can only see their own private state
- Public state visible to all room members
- Actions/votes hidden until resolution
- Bot memory never exposed to clients

## RNG System

**Seeded Randomness:**
```
season_seed (generated at room creation)
  ↓
round_seed = hash(season_seed + round_number)
  ↓
driver_outcome = race_rng(round_seed, driver_id, sabotage_state)
```

Benefits:
- Reproducible for debugging
- Auditable for anti-cheat
- Consistent across server restarts

## Expulsion Tracks

Three parallel pressure systems:

1. **Board Pressure**: Consecutive DNFs, poor performance
2. **Integrity Pressure**: Data leaks, internal sabotage detection
3. **Sporting Pressure**: Unsporting incidents, violations

Each track has thresholds defined in season rules. Reaching any threshold = team expelled = negative team wins.

## Bot System Architecture

**Bot Components:**
1. **Personality Profile**: Aggression, trust bias, accusation threshold
2. **Memory State**: Suspicion scores, vote history, claim tracking
3. **Decision Engine**: Utility scoring for actions/votes
4. **Phrase Generator**: Template selection with context tags
5. **Safety Validator**: Rejects contradictory/nonsensical outputs

**Bot Decision Pipeline:**
```
Context (race result, discussion state, private info)
  ↓
Intent Selection (accuse/defend/confuse/react)
  ↓
Action Selection (utility scoring)
  ↓
Phrase Template Filtering (language, tone, context)
  ↓
Safety Check (consistency, frequency, appropriateness)
  ↓
Output (action + 0-2 messages)
```

## Configuration System

Centralized in `src/config/deductionGame.ts`:
- Negative count table
- TP negative probability modes
- Base DNF rates
- Expulsion thresholds
- Bot personality presets
- Phrase libraries
- Timer durations

## Integration with Existing Site

**Auth Integration:**
- Uses existing `AuthContext`
- Player identity from Supabase auth
- Display names from user profiles

**Economy Integration (Optional for MVP):**
- Can reward winners with tokens
- Can charge entry fee
- Not required for first playable version

**Navigation:**
- Add route `/deduction-game` for lobby browser
- Add route `/deduction-game/:roomId` for game room
- Link from main nav or minigames section

## Scalability Considerations

**Current Scale (MVP):**
- 3-4 concurrent games max
- 4-8 players per game
- Supabase free tier sufficient

**Future Scale:**
- Edge function cold starts acceptable for now
- If >20 concurrent games, consider dedicated game server
- Bot decisions can be cached/precomputed

## Technology Stack

- **Frontend**: React 18, TypeScript, Vite
- **Backend**: Supabase (Postgres + Edge Functions + Realtime)
- **State**: React Context + Realtime subscriptions
- **Styling**: Tailwind CSS (existing)
- **i18n**: i18next (existing)

## File Structure

```
src/
  pages/
    DeductionGame.tsx          # Lobby browser
    DeductionGameRoom.tsx      # Game room
  components/
    deduction/
      Lobby.tsx
      GameBoard.tsx
      RoleActionPanel.tsx
      DiscussionChat.tsx
      VotingPanel.tsx
      RaceReport.tsx
      EndgameScreen.tsx
  context/
    DeductionGameContext.tsx
  config/
    deductionGame.ts
  types/
    deduction.ts
  utils/
    deductionHelpers.ts

supabase/
  migrations/
    20260506_deduction_game_schema.sql
  functions/
    deduction-create-room/
    deduction-join-room/
    deduction-start-game/
    deduction-submit-action/
    deduction-resolve-round/
    deduction-submit-vote/
    deduction-resolve-vote/
    deduction-bot-decide/
```
