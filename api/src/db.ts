// Postgres, through Bun's own client — no ORM, no query builder. The registry
// is three tables; anything that needs more than SQL needs a second look.
import { SQL } from "bun";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL missing");

export const sql = new SQL(url);

export type Founder = {
  id: string;
  number: number;
  name: string;
  created: Date;
};

export type Passkey = {
  id: string;
  founder_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
};
