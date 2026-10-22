/**
 * Stable QForge diagnostic codes.
 *
 * Codes are part of the public contract: once published, a code never changes
 * meaning and is never reused for a different condition. Ranges are grouped by
 * the compilation stage that raises them.
 *
 *   QF0xx  lexical analysis
 *   QF1xx  parsing
 *   QF2xx  semantic analysis
 *   QF3xx  resource limits
 *   QF4xx  backends / code generation
 *
 * `docs/language-spec.md` documents every code with an example.
 */
export const ErrorCode = {
  // --- Lexical (QF0xx) ---
  InvalidCharacter: 'QF001',
  UnterminatedBlockComment: 'QF002',
  MalformedNumber: 'QF003',
  NumberOutOfRange: 'QF004',

  // --- Syntax (QF1xx) ---
  UnexpectedToken: 'QF101',
  ExpectedSemicolon: 'QF102',
  ExpectedIdentifier: 'QF103',
  UnbalancedParenthesis: 'QF104',
  ExpectedArrow: 'QF105',
  ExpectedExpression: 'QF106',
  UnexpectedEndOfInput: 'QF107',
  ExpectedCloseBracket: 'QF108',
  ExpectedRegisterSize: 'QF109',
  ExpectedComma: 'QF110',
  ExpressionTooDeep: 'QF111',
  ExpectedCondition: 'QF112',
  ExpectedBrace: 'QF113',

  // --- Semantic (QF2xx) ---
  DuplicateDeclaration: 'QF201',
  UnknownIdentifier: 'QF202',
  UnknownGate: 'QF203',
  GateArityMismatch: 'QF204',
  GateParameterMismatch: 'QF205',
  BitUsedAsQubit: 'QF206',
  QubitUsedAsBit: 'QF207',
  DuplicateQubitOperand: 'QF208',
  InvalidMeasurementTarget: 'QF209',
  NonConstantExpression: 'QF210',
  IndexOutOfRange: 'QF211',
  CannotIndexScalar: 'QF212',
  RegisterWhereSingleExpected: 'QF213',
  DivisionByZero: 'QF214',
  InvalidRegisterSize: 'QF215',
  UnsupportedFeature: 'QF216',
  ConstantNotNumeric: 'QF217',
  ConditionNotClassical: 'QF218',
  ConditionValueOutOfRange: 'QF219',
  NestedConditional: 'QF220',
  EmptyConditionalBody: 'QF221',

  // --- Resource limits (QF3xx) ---
  TooManyQubits: 'QF301',
  SourceTooLarge: 'QF302',
  TooManyInstructions: 'QF303',
  ShotCountOutOfRange: 'QF304',
  TooManyClassicalBits: 'QF305',

  // --- Backends (QF4xx) ---
  OpcodeNotRepresentable: 'QF401',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
