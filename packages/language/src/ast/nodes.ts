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
  | BarrierStatement;

export interface Program extends NodeBase {
  readonly kind: 'Program';
  readonly statements: readonly Statement[];
}

export type AstNode = Program | Statement | Expression | OperandRef;

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

/** Pre-order depth-first walk. */
export function walk(node: AstNode, visit: (n: AstNode) => void): void {
  visit(node);
  for (const child of childrenOf(node)) walk(child, visit);
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
