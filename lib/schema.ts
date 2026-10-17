// Unique constraints do the important work here:
//   messages.provider_message_id  -> an inbound message is stored once, however often the provider redelivers it
//   messages.dedupe_key           -> an outbound message is sent once, however often a step is retried
//   decisions.trigger_message_id  -> each inbound message gets exactly one decision (the claim)
export const SCHEMA = `
create table if not exists contacts (
  id text primary key,
  name text not null,
  company text not null,
  phone text not null unique,
  opted_out_at timestamptz,
  operator_owned boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id bigserial primary key,
  contact_id text not null references contacts(id),
  direction text not null check (direction in ('in', 'out')),
  actor text not null check (actor in ('prospect', 'automation', 'ai', 'operator')),
  body text not null,
  provider_message_id text unique,
  dedupe_key text unique,
  created_at timestamptz not null default now()
);

create table if not exists decisions (
  id bigserial primary key,
  contact_id text not null references contacts(id),
  trigger_message_id bigint not null unique references messages(id),
  status text not null,
  stage text,
  intent text,
  confidence real,
  reply text,
  reason text,
  attempts jsonb not null default '[]',
  follow_up_days int,
  model text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cost_micros bigint not null default 0,
  approved_by text,
  edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists events (
  id bigserial primary key,
  contact_id text,
  message_id bigint,
  decision_id bigint,
  kind text not null,
  tone text not null default 'info',
  summary text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists settings (
  key text primary key,
  value jsonb not null
);

create index if not exists messages_contact_idx on messages (contact_id, id);
create index if not exists events_contact_idx on events (contact_id, id);
create index if not exists decisions_status_idx on decisions (status);
`;
