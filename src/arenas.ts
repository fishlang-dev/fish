import type { Instance, Local } from "./check.ts";
import type { Body, ClassInfo } from "./classes.ts";

// What names one of a compilation's instances, bodies, locals or classes: its place in that
// compilation's arena, from 1, so no id is falsy. Each kind of id is branded so one can't pass for
// another.
export type InstanceId = Brand<usize, "instance">;
export type BodyId = Brand<usize, "body">;
export type LocalId = Brand<usize, "local">;
export type ClassId = Brand<usize, "class">;

// The body an instance checks, from its compilation's arena.
export function bodyOf<A extends Lifetime>(arenas: Ref<Arenas, A>, instance: Ref<Instance>): Ref<Body, A> {
  return arenas.bodyOf(instance.body);
}

// A compilation's instances, bodies, locals and classes, each kept where it is made and named by
// its id, which is how the others refer to it.
export class Arenas {
  private instances: Instance[] = [];
  private bodies: Body[] = [];
  private locals: Local[] = [];
  private classes: ClassInfo[] = [];

  instanceOf(id: InstanceId): Ref<Instance>;
  instanceOf(id: InstanceId | undefined): Ref<Instance> | undefined;
  instanceOf(id: InstanceId | undefined): Ref<Instance> | undefined {
    return id === undefined ? undefined : this.instances[id - 1];
  }

  bodyOf(id: BodyId): Ref<Body>;
  bodyOf(id: BodyId | undefined): Ref<Body> | undefined;
  bodyOf(id: BodyId | undefined): Ref<Body> | undefined {
    return id === undefined ? undefined : this.bodies[id - 1];
  }

  // A body or a class to change in place.
  bodyMut(this: Mut<this>, id: BodyId): Mut<Body> {
    return this.bodies[id - 1]!;
  }

  classMut(this: Mut<this>, id: ClassId): Mut<ClassInfo> {
    return this.classes[id - 1]!;
  }

  localOf(id: LocalId): Ref<Local>;
  localOf(id: LocalId | undefined): Ref<Local> | undefined;
  localOf(id: LocalId | undefined): Ref<Local> | undefined {
    return id === undefined ? undefined : this.locals[id - 1];
  }

  classOf(id: ClassId): Ref<ClassInfo>;
  classOf(id: ClassId | undefined): Ref<ClassInfo> | undefined;
  classOf(id: ClassId | undefined): Ref<ClassInfo> | undefined {
    return id === undefined ? undefined : this.classes[id - 1];
  }

  addInstance(this: Mut<this>, instance: Omit<Instance, "id">): Mut<Instance> {
    this.instances.push({ id: (this.instances.length + 1) as InstanceId, ...instance } as Instance);
    return this.instances[this.instances.length - 1]!;
  }

  addLocal(this: Mut<this>, local: Omit<Local, "localId">): Mut<Local> {
    this.locals.push({ ...local, localId: (this.locals.length + 1) as LocalId } as Local);
    return this.locals[this.locals.length - 1]!;
  }

  addClass(this: Mut<this>, info: Omit<ClassInfo, "classId">): Mut<ClassInfo> {
    this.classes.push({ ...info, classId: (this.classes.length + 1) as ClassId } as ClassInfo);
    return this.classes[this.classes.length - 1]!;
  }

  // A body is often a function declaration the parser made, met again by every check that reaches
  // it, or a copy of one carrying the copied body's id, so it is added the first time it is met as
  // itself: a copy has a node id of its own. The arena keeps its own copy, and the body given is
  // numbered too, so meeting it again finds that copy.
  addBody(this: Mut<this>, body: Omit<Body, "bodyId"> & { bodyId?: BodyId }): Mut<Body> {
    const at = body.bodyId;
    if (at !== undefined && at <= this.bodies.length && this.bodies[at - 1]!.id === body.id) return this.bodies[at - 1]!;
    const bodyId = (this.bodies.length + 1) as BodyId;
    body.bodyId = bodyId;
    this.bodies.push({ ...body, bodyId });
    return this.bodies[this.bodies.length - 1]!;
  }
}
