import type { Instance, Local } from "./check.ts";
import type { Body, ClassInfo } from "./classes.ts";

// What names one of a compilation's instances, bodies, locals or classes: its place in that
// compilation's arena, from 1, so no id is falsy. `__arena` is for tsc only, which keeps one kind
// of id from passing for another.
export type InstanceId = usize & { readonly __arena?: "instance" };
export type BodyId = usize & { readonly __arena?: "body" };
export type LocalId = usize & { readonly __arena?: "local" };
export type ClassId = usize & { readonly __arena?: "class" };

// The body an instance checks, from its compilation's arena.
export function bodyOf(instance: Instance): Body {
  return instance.tables.arenas.bodyOf(instance.body);
}

// A compilation's instances, bodies, locals and classes, each kept where it is made and named by
// its id, which is how the others refer to it.
export class Arenas {
  private instances: Instance[] = [];
  private bodies: Body[] = [];
  private locals: Local[] = [];
  private classes: ClassInfo[] = [];

  instanceOf(id: InstanceId): Instance;
  instanceOf(id: InstanceId | undefined): Instance | undefined;
  instanceOf(id: InstanceId | undefined): Instance | undefined {
    return id === undefined ? undefined : this.instances[id - 1];
  }

  bodyOf(id: BodyId): Body;
  bodyOf(id: BodyId | undefined): Body | undefined;
  bodyOf(id: BodyId | undefined): Body | undefined {
    return id === undefined ? undefined : this.bodies[id - 1];
  }

  localOf(id: LocalId): Local;
  localOf(id: LocalId | undefined): Local | undefined;
  localOf(id: LocalId | undefined): Local | undefined {
    return id === undefined ? undefined : this.locals[id - 1];
  }

  classOf(id: ClassId): ClassInfo;
  classOf(id: ClassId | undefined): ClassInfo | undefined;
  classOf(id: ClassId | undefined): ClassInfo | undefined {
    return id === undefined ? undefined : this.classes[id - 1];
  }

  addInstance(instance: Omit<Instance, "id">): Instance {
    const made = { id: this.instances.length + 1, ...instance } as Instance;
    this.instances.push(made);
    return made;
  }

  addLocal(local: Omit<Local, "localId">): Local {
    const made = { ...local, localId: this.locals.length + 1 } as Local;
    this.locals.push(made);
    return made;
  }

  addClass(info: Omit<ClassInfo, "classId">): ClassInfo {
    const made = { ...info, classId: this.classes.length + 1 } as ClassInfo;
    this.classes.push(made);
    return made;
  }

  // A body is often a function declaration the parser made, met again by every check that reaches
  // it, or a copy of one carrying the copied body's id, so it is added the first time it is met as
  // itself.
  addBody<B extends Omit<Body, "bodyId">>(body: B): B & Body {
    const b = body as B & Body;
    if (this.bodies[b.bodyId - 1] !== b) {
      this.bodies.push(b);
      b.bodyId = this.bodies.length;
    }
    return b;
  }
}
