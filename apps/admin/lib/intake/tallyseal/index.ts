// Boundary facade barrel — the SINGLE import surface for @tallyseal/*
// in HF. Import from "@/lib/intake/tallyseal" everywhere; never from
// @tallyseal/* or @anthropic-ai/sdk directly.
//
// See ./README.md for the discipline statement.

export * from "./types";
export * from "./builders";
export * from "./runtime";
export * from "./regulations";
export * from "./ui";
export * from "./ai";
