import type { SourceSpan } from '../diagnostics/span.js';

/**
 * QForge abstract syntax tree.
 *
 * Every node carries a `span`, which is what makes "click a statement, see its
 * IR instruction" possible in the studio: lowering copies the span onto each IR
 * instruction, so a source range maps forward to gates and a gate maps back to
 * a source range.
 */

export interface NodeBase {
  readonly span: SourceSpan;
}

// --------------------------------------------------------------------------
// Expressions (rotation angles and register sizes)
// --------------------------------------------------------------------------

export interface NumberLiteral extends NodeBase {
  readonly kind: 'NumberLiteral';
  readonly value: number;
}

/** A bare name in expression position: a named constant such as `pi`. */
export interface IdentifierExpr extends NodeBase {
  readonly kind: 'IdentifierExpr';
  readonly name: string;
}

export type UnaryOperator = '+' | '-';

export interface UnaryExpr extends NodeBase {
  readonly kind: 'UnaryExpr';
  readonly operator: UnaryOperator;
  readonly operand: Expression;
}

export type BinaryOperator = '+' | '-' | '*' | '/' | '^';

export interface BinaryExpr extends NodeBase {
  readonly kind: 'BinaryExpr';
  readonly operator: BinaryOperator;
  readonly left: Expression;
  readonly right: Expression;
}

/** Explicit parentheses, retained so the formatter can reproduce user intent. */
export interface GroupExpr extends NodeBase {
  readonly kind: 'GroupExpr';
  readonly inner: Expression;
}

export type Expression = NumberLiteral | IdentifierExpr | UnaryExpr | BinaryExpr | GroupExpr;

// --------------------------------------------------------------------------
// Operand references
// --------------------------------------------------------------------------

/**
 * A reference to a declared qubit or classical bit, optionally indexed.
 *
 *   alice        -> { name: 'alice' }
 *   q[2]         -> { name: 'q', index: <expr 2> }
 */
export interface OperandRef extends NodeBase {
  readonly kind: 'OperandRef';
  readonly name: string;
  /** Present only for indexed references such as `q[0]`. */
  readonly index?: Expression;
  /** Span of the bare name, used to underline the identifier alone. */
  readonly nameSpan: SourceSpan;
}

// --------------------------------------------------------------------------
// Statements
// --------------------------------------------------------------------------

/** `qubit alice;` or `qubit[3] q;` */
export interface QubitDeclaration extends NodeBase {
  readonly kind: 'QubitDeclaration';
  readonly name: string;
  readonly nameSpan: SourceSpan;
  /** Absent for a scalar qubit; present for a register declaration. */
  readonly size?: Expression;
}

/** `bit result;` or `bit[3] c;` */
export interface BitDeclaration extends NodeBase {
  readonly kind: 'BitDeclaration';
  readonly name: string;
  readonly nameSpan: SourceSpan;
  readonly size?: Expression;
}

/** `const theta = pi / 4;` */
export interface ConstDeclaration extends NodeBase {
  readonly kind: 'ConstDeclaration';
  readonly name: string;
  readonly nameSpan: SourceSpan;
  readonly value: Expression;
}

/** `h alice;` `cx a, b;` `rx(pi/2) q;` */
export interface GateApplication extends NodeBase {
  readonly kind: 'GateApplication';
  readonly gate: string;
  readonly gateSpan: SourceSpan;
  /** Empty for non-parameterised gates. */
  readonly params: readonly Expression[];
  /** Span covering `( ... )`, absent when no parameter list was written. */
  readonly paramListSpan?: SourceSpan;
  readonly operands: readonly OperandRef[];
}

/** `measure alice -> result;` */
export interface MeasureStatement extends NodeBase {
  readonly kind: 'MeasureStatement';
  readonly qubit: OperandRef;
  readonly target: OperandRef;
}

/** `reset q;` */
export interface ResetStatement extends NodeBase {
  readonly kind: 'ResetStatement';
  readonly qubit: OperandRef;
}

/**
 * The condition of an `if`: an equality test between a classical bit (or a
 * whole classical register) and an integer literal.
 *
 * Deliberately not a general boolean expression. QForge's conditionals exist to
 * express measurement feed-forward -- the thing teleportation needs -- and
 * every construct admitted here has to have defined semantics in the simulator,
 * in the optimiser's safety analysis, and in the OpenQASM backend. An equality
 * test against a constant is the smallest form that does the job.
 */
export interface ConditionExpr extends NodeBase {
  readonly kind: 'ConditionExpr';
  /** The classical bit or register being tested. */
  readonly target: OperandRef;
  readonly operator: '==' | '!=';
  /** Right-hand side; must fold to a non-negative integer. */
  readonly value: Expression;
}

/**
 * `if (c == 1) x q;` or `if (c == 1) { x q; z q; }`
 *
 * The body holds quantum operations only. There is no `else`, so the grammar
 * has no dangling-else ambiguity, and conditionals do not nest -- see
 * docs/classical-control-design.md for why both restrictions are deliberate.
 */
export interface IfStatement extends NodeBase {
  readonly kind: 'IfStatement';
  readonly condition: ConditionExpr;
  readonly body: readonly Statement[];
  /** True when the body was written as a `{ ... }` block. */
  readonly braced: boolean;
}

/** `barrier;` or `barrier a, b;` — an optimisation fence. */
export interface BarrierStatement extends NodeBase {
  readonly kind: 'BarrierStatement';
  /** Empty means "all qubits". */
  readonly qubits: readonly OperandRef[];
}

export type Statement =
  | QubitDeclaration
  | BitDeclaration
  | ConstDeclaration
  | GateApplication
  | MeasureStatement
  | ResetStatement
  | BarrierStatement
  | IfStatement;

export interface Program extends NodeBase {
  readonly kind: 'Program';
  readonly statements: readonly Statement[];
}

export type AstNode = Program | Statement | Expression | OperandRef | ConditionExpr;

// --------------------------------------------------------------------------
// Traversal
// --------------------------------------------------------------------------

/** Direct children of a node, in source order. */
export function childrenOf(node: AstNode): AstNode[] {
  switch (node.kind) {
    case 'Program':
      return [...node.statements];
    case 'QubitDeclaration':
    case 'BitDeclaration':
      return node.size ? [node.size] : [];
    case 'ConstDeclaration':
      return [node.value];
    case 'GateApplication':
      return [...node.params, ...node.operands];
    case 'MeasureStatement':
      return [node.qubit, node.target];
    case 'ResetStatement':
      return [node.qubit];
    case 'BarrierStatement':
      return [...node.qubits];
    case 'IfStatement':
      return [node.condition, ...node.body];
    case 'ConditionExpr':
      return [node.target, node.value];
    case 'OperandRef':
      return node.index ? [node.index] : [];
    case 'UnaryExpr':
      return [node.operand];
    case 'BinaryExpr':
      return [node.left, node.right];
    case 'GroupExpr':
      return [node.inner];
    case 'NumberLiteral':
    case 'IdentifierExpr':
      return [];
  }
}

/**
 * Pre-order depth-first walk.
 *
 * Iterative rather than recursive. The parser bounds expression depth, but this
 * runs on every caret move in the studio and is exported for callers who may
 * build a tree themselves, so it should not depend on that bound holding.
 */
export function walk(node: AstNode, visit: (n: AstNode) => void): void {
  const stack: AstNode[] = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    visit(current);
    const children = childrenOf(current);
    // Push in reverse so children are visited left to right.
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  }
}

/**
 * Innermost node whose span contains `offset`, or undefined.
 * Powers "select a statement in the editor, highlight its IR".
 */
export function nodeAtOffset(root: AstNode, offset: number): AstNode | undefined {
  let best: AstNode | undefined;
  walk(root, (n) => {
    if (offset >= n.span.start && offset < n.span.end) {
      if (!best || n.span.end - n.span.start <= best.span.end - best.span.start) best = n;
    }
  });
  return best;
}

/** The top-level statement containing `offset`, or undefined. */
export function statementAtOffset(program: Program, offset: number): Statement | undefined {
  return program.statements.find((s) => offset >= s.span.start && offset < s.span.end);
}
