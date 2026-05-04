-- 003: projects + project_members.
-- Projetos são compartilhados entre membros do time. Quem cria entra como 'owner'.

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS projects_owner_sub_idx ON projects (owner_sub, created_at DESC);

CREATE TABLE IF NOT EXISTS project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  member_sub TEXT NOT NULL,
  member_email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  added_by TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, member_sub)
);

ALTER TABLE project_members
  ADD CONSTRAINT project_members_role_check
  CHECK (role IN ('owner', 'member'));

CREATE INDEX IF NOT EXISTS project_members_member_sub_idx ON project_members (member_sub);
CREATE INDEX IF NOT EXISTS project_members_project_id_idx ON project_members (project_id);
