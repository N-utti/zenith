"""협업 공간 — 프로젝트 칸반보드 (README "설계와 어긋나는 것" 40 · 프론트 #359 — 04·01 밖).

프론트 목(`mocks/projectsDb.ts`·`handlers.ts` 의 `/api/projects`·`/api/project-tasks`)을 역설계한 계약 그대로.
- 권한: 로그인하면 누구나 보고 만들고 고친다. 프로젝트 지우기만 만든 사람·exec(아니면 403 + 감사 `acl.denied`).
- 프로젝트는 행째 지운다(되살리기 없음). 딸린 업무는 DB 가 같이 지운다(ON DELETE CASCADE). 감사 `projects.deleted`.
- 단계·중요도는 프론트 상수(`features/projects/types.ts`)와 같은 네 칸·세 칸. 담당자는 활성 사용자만(아니면 422).
- 검증 실패는 전부 422 `VALIDATION`, 없는 것은 404.

ponytail: 페이징 없음 — 사내 프로젝트가 1000개를 넘으면 그때 커서를 단다(할 일과 같은 천장).
"""

import uuid
from datetime import UTC, date, datetime
from typing import Annotated, Literal, NoReturn

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, StringConstraints
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit
from app.db import get_db
from app.deps import current_user
from app.errors import ApiError
from app.models import Project, ProjectTask, User

router = APIRouter(tags=["projects"], dependencies=[Depends(current_user)])

Stage = Literal["todo", "doing", "review", "done"]
Priority = Literal["high", "normal", "low"]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]


# ── 모양 ─────────────────────────────────────────────────────────────────────


class Person(BaseModel):
    id: uuid.UUID
    name: str


class Items[T](BaseModel):
    items: list[T]


class ProjectOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str
    created_by: Person
    created_at: datetime
    task_count: int
    done_count: int
    can_delete: bool  # 만든 사람·exec — 서버가 판정, 화면은 이 값으로만 버튼을 그린다


class ProjectIn(BaseModel):
    name: Name
    description: Description = ""


class ProjectPatch(BaseModel):
    name: Name | None = None
    description: Description | None = None


class TaskOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    title: str
    stage: Stage
    assignee: Person | None
    due_date: date | None
    priority: Priority
    note: str
    created_at: datetime


class TaskIn(BaseModel):
    title: Title
    stage: Stage = "todo"
    assignee_id: uuid.UUID | None = None
    due_date: date | None = None
    priority: Priority = "normal"
    note: Note = ""


class TaskPatch(BaseModel):
    title: Title | None = None
    stage: Stage | None = None
    assignee_id: uuid.UUID | None = None
    due_date: date | None = None
    priority: Priority | None = None
    note: Note | None = None


# ── 도우미 ───────────────────────────────────────────────────────────────────


def _invalid(detail: str) -> NoReturn:
    raise ApiError(422, "VALIDATION", detail)


async def _deny(db: AsyncSession, request: Request, user: User, target_id: uuid.UUID) -> NoReturn:
    audit.record(
        db,
        "acl.denied",
        request=request,
        actor_id=user.id,
        target_id=target_id,
        detail={"path": request.url.path, "reason": "delete", "role": user.role},
    )
    await db.commit()
    raise ApiError(403, "FORBIDDEN", "만든 사람과 임원만 지울 수 있습니다.")


async def _project(
    db: AsyncSession, project_id: uuid.UUID, *, lock: Literal["share", "update"] | None = None
) -> Project:
    """`lock` — 업무 만들기는 share, 프로젝트 지우기는 update: 존재 확인과 INSERT 사이에 지워지면 FK 위반 500 이 났다."""
    if lock:
        project = await db.scalar(
            select(Project).where(Project.id == project_id).with_for_update(read=lock == "share")
        )
    else:
        project = await db.get(Project, project_id)
    if project is None:
        raise ApiError(404, "NOT_FOUND", "프로젝트를 찾을 수 없습니다.")
    return project


async def _task(db: AsyncSession, task_id: uuid.UUID) -> ProjectTask:
    task = await db.get(ProjectTask, task_id)
    if task is None:
        raise ApiError(404, "NOT_FOUND", "업무를 찾을 수 없습니다.")
    return task


async def _check_assignee(db: AsyncSession, user_id: uuid.UUID | None) -> None:
    if user_id is None:
        return
    active = await db.scalar(select(User.active).where(User.id == user_id))
    if active is not True:
        _invalid("담당자로 지정할 수 없는 사람입니다.")


async def _names(db: AsyncSession, ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    rows = await db.execute(select(User.id, User.name).where(User.id.in_(ids)))
    return dict(rows.tuples().all())


async def _projects_out(db: AsyncSession, projects: list[Project], user: User) -> list[ProjectOut]:
    if not projects:
        return []
    counts = await db.execute(
        select(
            ProjectTask.project_id,
            func.count(),
            func.count().filter(ProjectTask.stage == "done"),
        )
        .where(ProjectTask.project_id.in_([p.id for p in projects]))
        .group_by(ProjectTask.project_id)
    )
    by_project = {pid: (total, done) for pid, total, done in counts.tuples()}
    names = await _names(db, {p.created_by for p in projects})
    return [
        ProjectOut(
            id=p.id,
            name=p.name,
            description=p.description,
            created_by=Person(id=p.created_by, name=names.get(p.created_by, "")),
            created_at=p.created_at,
            task_count=by_project.get(p.id, (0, 0))[0],
            done_count=by_project.get(p.id, (0, 0))[1],
            can_delete=p.created_by == user.id or user.role == "exec",
        )
        for p in projects
    ]


async def _project_out(db: AsyncSession, project: Project, user: User) -> ProjectOut:
    return (await _projects_out(db, [project], user))[0]


async def _tasks_out(db: AsyncSession, tasks: list[ProjectTask]) -> list[TaskOut]:
    names = await _names(db, {t.assignee_id for t in tasks if t.assignee_id})
    return [
        TaskOut(
            id=t.id,
            project_id=t.project_id,
            title=t.title,
            stage=t.stage,
            assignee=Person(id=t.assignee_id, name=names.get(t.assignee_id, ""))
            if t.assignee_id
            else None,
            due_date=t.due_date,
            priority=t.priority,
            note=t.note,
            created_at=t.created_at,
        )
        for t in tasks
    ]


# ── 프로젝트 ─────────────────────────────────────────────────────────────────


@router.get(
    "/projects",
    response_model=Items[ProjectOut],
    summary="프로젝트 목록 — 전 직원, 최근에 만든 것부터 (04 밖, README 40)",
)
async def list_projects(
    user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> Items[ProjectOut]:
    rows = await db.execute(
        select(Project).order_by(Project.created_at.desc(), Project.id).limit(1000)
    )
    return Items(items=await _projects_out(db, list(rows.scalars()), user))


@router.post(
    "/projects",
    status_code=201,
    response_model=ProjectOut,
    summary="프로젝트 만들기 {name, description?}",
)
async def create_project(
    body: ProjectIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> ProjectOut:
    project = Project(
        name=body.name,
        description=body.description,
        created_by=user.id,
        created_at=datetime.now(
            UTC
        ),  # now() 은 트랜잭션 시각 — 목록 순서가 단위시간 안에서 같아진다
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return await _project_out(db, project, user)


@router.get("/projects/{id}", response_model=ProjectOut, summary="프로젝트 하나")
async def get_project(
    id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> ProjectOut:
    return await _project_out(db, await _project(db, id), user)


@router.patch(
    "/projects/{id}", response_model=ProjectOut, summary="프로젝트 고치기 {name?, description?}"
)
async def update_project(
    id: uuid.UUID,
    body: ProjectPatch,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> ProjectOut:
    project = await _project(db, id)
    for key, value in body.model_dump(exclude_unset=True).items():
        if value is None:
            _invalid(f"{key} 는 null 일 수 없습니다.")
        setattr(project, key, value)
    await db.commit()
    await db.refresh(project)
    return await _project_out(db, project, user)


@router.delete(
    "/projects/{id}",
    status_code=204,
    summary="프로젝트 지우기 — 만든 사람·임원만(403), 딸린 업무도 같이, 되살리기 없음",
)
async def delete_project(
    id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    project = await _project(db, id, lock="update")
    if project.created_by != user.id and user.role != "exec":
        await _deny(db, request, user, project.id)
    tasks = await db.scalar(
        select(func.count()).select_from(ProjectTask).where(ProjectTask.project_id == project.id)
    )
    audit.record(
        db,
        "projects.deleted",
        request=request,
        actor_id=user.id,
        target_id=project.id,
        detail={"name": project.name, "tasks": tasks},
    )
    await db.delete(project)
    await db.commit()
    return Response(status_code=204)


# ── 업무 ─────────────────────────────────────────────────────────────────────


@router.get(
    "/projects/{id}/tasks",
    response_model=Items[TaskOut],
    summary="프로젝트의 업무 전부 — 만든 순",
)
async def list_tasks(id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Items[TaskOut]:
    await _project(db, id)
    rows = await db.execute(
        select(ProjectTask)
        .where(ProjectTask.project_id == id)
        .order_by(ProjectTask.created_at, ProjectTask.id)
        .limit(5000)
    )
    return Items(items=await _tasks_out(db, list(rows.scalars())))


@router.post(
    "/projects/{id}/tasks",
    status_code=201,
    response_model=TaskOut,
    summary="업무 만들기 {title, stage?, assignee_id?, due_date?, priority?, note?} — 담당자는 활성 사용자만(422)",
)
async def create_task(id: uuid.UUID, body: TaskIn, db: AsyncSession = Depends(get_db)) -> TaskOut:
    await _project(db, id, lock="share")
    await _check_assignee(db, body.assignee_id)
    task = ProjectTask(project_id=id, created_at=datetime.now(UTC), **body.model_dump())
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return (await _tasks_out(db, [task]))[0]


@router.patch(
    "/project-tasks/{id}",
    response_model=TaskOut,
    summary="업무 고치기·단계 옮기기 — 바뀐 칸만 보낸다. assignee_id·due_date 만 null 로 비울 수 있다",
)
async def update_task(
    id: uuid.UUID, body: TaskPatch, db: AsyncSession = Depends(get_db)
) -> TaskOut:
    task = await _task(db, id)
    changes = body.model_dump(exclude_unset=True)
    for key, value in changes.items():
        if value is None and key not in ("assignee_id", "due_date"):
            _invalid(f"{key} 는 null 일 수 없습니다.")
    if "assignee_id" in changes:
        await _check_assignee(db, changes["assignee_id"])
    for key, value in changes.items():
        setattr(task, key, value)
    await db.commit()
    await db.refresh(task)
    return (await _tasks_out(db, [task]))[0]


@router.delete("/project-tasks/{id}", status_code=204, summary="업무 지우기")
async def delete_task(id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Response:
    await db.delete(await _task(db, id))
    await db.commit()
    return Response(status_code=204)
