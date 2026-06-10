import { randomUUID } from "node:crypto";
import type { Clock, IdGen } from "../ports.js";
export class SystemClock implements Clock { now(): string { return new Date().toISOString(); } }
export class RandomIdGen implements IdGen { uuid(): string { return randomUUID(); } }
