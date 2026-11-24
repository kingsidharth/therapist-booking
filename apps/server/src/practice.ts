import { DEFAULT_POLICIES } from "@app/shared";
import { isEmpty, type DB } from "./db";

const TZ = "America/New_York";

// ---------------------------------------------------------------------------
// Base data (therapist, weekly rules, time off, recurring blocks)
// ---------------------------------------------------------------------------

/** Weekly rules in minutes from local midnight. ISO weekday: Mon=1 … Sun=7 (off). */
const RULES: Array<[number, number, number]> = [
  [1, 9 * 60, 12 * 60], [1, 13 * 60, 17 * 60],
  [2, 11 * 60, 14 * 60], [2, 15 * 60, 19 * 60],
  [3, 9 * 60, 13 * 60],
  [4, 11 * 60, 14 * 60], [4, 15 * 60, 19 * 60],
  [5, 9 * 60, 14 * 60],
  [6, 10 * 60, 13 * 60],
];

export async function seedBase(db: DB): Promise<void> {
  await db.write(async (tx) => {
    if (!(await isEmpty(tx))) return;
    await tx.batch([
      {
        sql: `INSERT INTO therapist (id, name, credentials, bio, specialties_json, timezone, location, policies_json)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          "th_maya", "Dr. Maya Rao", "PhD, Licensed Clinical Psychologist",
          "Dr. Rao helps adults untangle anxiety, navigate big life changes, and strengthen their relationships using a warm, practical blend of CBT and mindfulness. She has been in private practice for over twelve years and sees clients via telehealth and in her Brooklyn office.",
          JSON.stringify(["Anxiety", "CBT", "Life transitions", "Couples"]), TZ, "Telehealth & Brooklyn, NY", JSON.stringify(DEFAULT_POLICIES),
        ],
      },
      ...RULES.map(args => ({
        sql: "INSERT INTO availability_rules (weekday, start_minute, end_minute) VALUES (?, ?, ?)",
        args,
      })),
      "INSERT INTO recurring_blocks (weekday, start_minute, reason) VALUES (3, 720, 'Clinical supervision')",
      `INSERT INTO time_off (id, start_date, end_date, reason) VALUES
        ('to_thanksgiving', '2026-11-26', '2026-11-27', 'Thanksgiving'),
        ('to_winter', '2026-12-24', '2027-01-01', 'Winter break')`,
    ]);
  });
}
