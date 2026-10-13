-- =====================================================================
-- Desgro — E-Sign / Agreements module  (Supabase / Postgres)
-- Replaces Odoo Sign. Includes staging tables for the Odoo migration.
-- Run in Supabase SQL editor (or as a migration). Idempotent-ish.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Enums ----------
do $$ begin
  create type esign_field_type as enum ('signature','initial','text','textarea','checkbox','radio','selection','date','name','email','phone');
  create type esign_request_status as enum ('draft','sent','viewed','partially_signed','signed','declined','expired','cancelled');
  create type esign_signer_status as enum ('waiting','sent','viewed','signed','declined','cancelled');
  create type esign_review_status as enum ('pending','approved','rejected','needs_fix');
exception when duplicate_object then null; end $$;

-- ---------- Master templates ----------
create table if not exists esign_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category      text not null,                -- AHPRA Agreement | AHPRA Pathway | Visa Agreement AUS | NZ Agreement | NCLEX RN Booking | Sales | Agent | Promotional
  description   text,
  default_expiry_days   int  default 14,
  default_reminder_days int  default 3,
  email_subject text,
  email_body    text,
  whatsapp_template_name text,                -- approved Meta template used to send the link
  active        boolean not null default true,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists esign_template_versions (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references esign_templates(id) on delete cascade,
  version      int  not null,
  file_path    text not null,                 -- storage: agreements/templates/<template_id>/v<version>.pdf
  file_sha256  text not null,
  num_pages    int  not null,
  is_current   boolean not null default false,
  notes        text,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  unique (template_id, version)
);
create unique index if not exists esign_one_current_version on esign_template_versions(template_id) where is_current;

-- Field boxes; coordinates are fractions (0–1) of the page, top-left origin — same convention as Odoo sign.item
create table if not exists esign_template_fields (
  id            uuid primary key default gen_random_uuid(),
  version_id    uuid not null references esign_template_versions(id) on delete cascade,
  key           text not null,                -- e.g. client_signature, fee_amount
  label         text,
  type          esign_field_type not null,
  role          text not null default 'Client', -- Client | DESMA | Witness ...
  page          int  not null,                -- 1-based
  x numeric(8,6) not null, y numeric(8,6) not null,
  w numeric(8,6) not null, h numeric(8,6) not null,
  required      boolean not null default true,
  options       jsonb,                        -- for radio/selection
  merge_key     text,                         -- if set, value is prefilled from the CRM record and locked for the signer
  font_size     int default 11,
  alignment     text default 'left',
  sort_order    int default 0
);
create index if not exists esign_fields_version on esign_template_fields(version_id);

-- ---------- Requests ----------
create table if not exists esign_requests (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null,            -- "AHPRA Agreement – <Client Name>"
  subject           text,
  message           text,
  category          text,
  tags              text[] not null default '{}',
  client_id         uuid,                     -- FK to Desgro clients/leads table (add constraint to match your schema)
  template_version_id uuid references esign_template_versions(id),
  status            esign_request_status not null default 'draft',
  merge_data        jsonb not null default '{}', -- snapshot of CRM values used at send time
  original_path     text,                     -- PDF as sent (merge fields burned in), before signatures
  original_sha256   text,
  signed_path       text,
  signed_sha256     text,
  certificate_path  text,
  expires_at        timestamptz,
  reminder_days     int,
  last_reminder_at  timestamptz,
  sent_at           timestamptz,
  completed_at      timestamptz,
  cancelled_reason  text,
  cc                jsonb not null default '[]', -- [{name,email}]
  source            text not null default 'desgro', -- desgro | odoo
  odoo_id           int unique,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists esign_requests_client on esign_requests(client_id);
create index if not exists esign_requests_status on esign_requests(status);
create index if not exists esign_requests_tags on esign_requests using gin(tags);

create table if not exists esign_signers (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references esign_requests(id) on delete cascade,
  role           text not null default 'Client',
  name           text not null,
  email          text,
  phone          text,
  sign_order     int not null default 1,
  status         esign_signer_status not null default 'waiting',
  token_hash     text unique,                 -- sha256 of the link token; raw token only ever in the link
  token_expires_at timestamptz,
  otp_hash       text,
  otp_expires_at timestamptz,
  otp_attempts   int not null default 0,
  otp_channel    text,                        -- email | whatsapp
  viewed_at      timestamptz,
  signed_at      timestamptz,
  declined_at    timestamptz,
  decline_reason text,
  ip             inet,
  user_agent     text,
  latitude       double precision,
  longitude      double precision,
  odoo_item_id   int unique,
  created_at     timestamptz not null default now()
);
create index if not exists esign_signers_request on esign_signers(request_id);

create table if not exists esign_field_values (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references esign_requests(id) on delete cascade,
  signer_id    uuid references esign_signers(id) on delete cascade,
  field_id     uuid references esign_template_fields(id),
  field_key    text,
  field_type   esign_field_type,
  page int, x numeric(8,6), y numeric(8,6), w numeric(8,6), h numeric(8,6),
  value        text,                          -- text value, or storage path for signature/initial images
  created_at   timestamptz not null default now()
);
create index if not exists esign_values_request on esign_field_values(request_id);

-- ---------- Audit trail (append-only, hash-chained) ----------
create table if not exists esign_events (
  id          bigserial primary key,
  request_id  uuid not null references esign_requests(id) on delete cascade,
  signer_id   uuid references esign_signers(id),
  action      text not null,                  -- created|sent|reminder|opened|otp_sent|otp_verified|otp_failed|field_saved|signed|declined|completed|expired|cancelled|downloaded|imported
  actor       text,                           -- staff email, signer name, or 'system'
  ip          inet,
  user_agent  text,
  meta        jsonb not null default '{}',
  prev_hash   text,
  hash        text,
  created_at  timestamptz not null default now()
);
create index if not exists esign_events_request on esign_events(request_id, id);

create or replace function esign_events_chain() returns trigger language plpgsql as $$
declare p text;
begin
  select hash into p from esign_events where request_id = new.request_id order by id desc limit 1;
  new.prev_hash := coalesce(p, '');
  new.hash := encode(digest(
      coalesce(new.prev_hash,'') || '|' || new.request_id::text || '|' || coalesce(new.signer_id::text,'') || '|' ||
      new.action || '|' || coalesce(host(new.ip),'') || '|' || new.meta::text || '|' || new.created_at::text, 'sha256'), 'hex');
  return new;
end $$;
drop trigger if exists trg_esign_events_chain on esign_events;
create trigger trg_esign_events_chain before insert on esign_events for each row execute function esign_events_chain();

create or replace function esign_events_immutable() returns trigger language plpgsql as $$
begin raise exception 'esign_events is append-only'; end $$;
drop trigger if exists trg_esign_events_immutable on esign_events;
create trigger trg_esign_events_immutable before update or delete on esign_events for each row execute function esign_events_immutable();

-- ---------- Odoo migration staging (review-before-live) ----------
create table if not exists esign_import_batches (
  id          uuid primary key default gen_random_uuid(),
  file_name   text not null unique,           -- odoo-sign-batch-001.zip
  record_count int not null default 0,
  file_count  int not null default 0,
  failed_files int not null default 0,
  imported_at timestamptz not null default now()
);

create table if not exists esign_import_records (
  id                 uuid primary key default gen_random_uuid(),
  batch_id           uuid references esign_import_batches(id) on delete set null,
  odoo_id            int not null unique,
  reference          text,
  odoo_state         text,
  tags               text[] default '{}',
  signer_name        text,
  signer_email       text,
  signer_phone       text,
  payload            jsonb not null,          -- full record.json from the export
  files              jsonb not null default '[]', -- [{kind,name,storage_path,sha256,size,verified}]
  files_verified     boolean not null default false,
  match_status       text not null default 'unmatched', -- matched | ambiguous | unmatched | manual
  matched_client_id  uuid,
  match_candidates   jsonb default '[]',
  review_status      esign_review_status not null default 'pending',
  review_note        text,
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  promoted_request_id uuid references esign_requests(id),
  created_at         timestamptz not null default now()
);
create index if not exists esign_import_review on esign_import_records(review_status, match_status);

-- ---------- RLS (server uses service role; staff access via policies you add) ----------
alter table esign_templates          enable row level security;
alter table esign_template_versions  enable row level security;
alter table esign_template_fields    enable row level security;
alter table esign_requests           enable row level security;
alter table esign_signers            enable row level security;
alter table esign_field_values       enable row level security;
alter table esign_events             enable row level security;
alter table esign_import_batches     enable row level security;
alter table esign_import_records     enable row level security;

-- Storage: create a PRIVATE bucket named 'agreements' (Dashboard → Storage), no public access.
-- Layout:
--   agreements/templates/<template_id>/v<n>.pdf
--   agreements/requests/<request_id>/original.pdf | signed.pdf | certificate.pdf | sig_<signer_id>.png
--   agreements/odoo/<odoo_id>/<kind>__<filename>.pdf
