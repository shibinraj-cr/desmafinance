-- Party.name was GLOBALLY unique, which prevented a Candidate and a Vendor from
-- sharing a name (e.g. a landlord and a student who happen to share a first
-- name). Enrollment's findOrCreateParty then matched the wrong-group party by
-- name and mis-linked that candidate's finance draft / closed-won pipeline /
-- party-service to the vendor. Make the name unique PER GROUP so both coexist.
--
-- Safe on existing data: because `name` alone was unique, every (name, group)
-- pair is already unique, so the new unique index cannot conflict.

DROP INDEX "Party_name_key";

CREATE UNIQUE INDEX "Party_name_group_key" ON "Party"("name", "group");
