// Paste this entire file into https://peggyjs.org/online.html.
// Produces a syntax AST; field validation and query execution are separate.
{
  function combine(type, head, tail) {
    return tail.length ? { type, operands: [head, ...tail] } : head;
  }

  function negate(operators, expression) {
    return operators.reduceRight(
      (operand) => ({ type: "not", operand }),
      expression,
    );
  }

  function checkDepth(node, depth = 0) {
    if (node.type === "filter") {
      if (depth >= 2) error("Only one level of nested filters is supported.");
      checkDepth(node.expression, depth + 1);
    } else if (node.operands) {
      node.operands.forEach((operand) => checkDepth(operand, depth));
    } else if (node.operand) {
      checkDepth(node.operand, depth);
    }
  }
}

Query
  = Spacing expression:Expression Spacing !. {
      checkDepth(expression);
      return expression;
    }

Expression
  = OrExpression

OrExpression
  = head:AndExpression tail:(
      Whitespace "OR" !IdentifierCharacter Whitespace right:AndExpression {
        return right;
      }
    )* {
      return combine("or", head, tail);
    }

AndExpression
  = head:UnaryExpression tail:(
      Whitespace "AND" !IdentifierCharacter Whitespace
      right:UnaryExpression { return right; }
    )* {
      return combine("and", head, tail);
    }

UnaryExpression
  = operators:NegationOperator* expression:Primary {
      return negate(operators, expression);
    }

NegationOperator
  = "NOT" !IdentifierCharacter Whitespace

Primary
  = Filter
  / Group
  / StringComparison

Group
  = "(" Spacing expression:Expression Spacing ")" {
      return expression;
    }

Filter
  = name:Identifier "(" Spacing expression:ContentOrExpression Spacing ")" {
      return { type: "filter", name, expression };
    }

ContentOrExpression
  = head:ContentAndExpression tail:(
      Whitespace "OR" !IdentifierCharacter Whitespace
      right:ContentAndExpression { return right; }
    )* {
      return combine("or", head, tail);
    }

ContentAndExpression
  = head:ContentUnaryExpression tail:(
      Whitespace "AND" !IdentifierCharacter Whitespace
      right:ContentUnaryExpression { return right; }
    )* {
      return combine("and", head, tail);
    }

ContentUnaryExpression
  = operators:NegationOperator* expression:ContentPrimary {
      return negate(operators, expression);
    }

ContentPrimary
  = Filter
  / "(" Spacing expression:ContentOrExpression Spacing ")" {
      return expression;
    }
  / ValueComparison

ValueComparison
  = operator:NumericOperator Whitespace value:Quantity {
      return { type: "comparison", operator, value };
    }
  / StringComparison
  / value:ScalarValue {
      return { type: "comparison", operator: "equal", value };
    }

NumericOperator
  = "ABOVE" !IdentifierCharacter { return "above"; }
  / "BELOW" !IdentifierCharacter { return "below"; }
  / "AT" Whitespace "LEAST" !IdentifierCharacter { return "atLeast"; }
  / "AT" Whitespace "MOST" !IdentifierCharacter { return "atMost"; }

StringComparison
  = operator:StringOperator Whitespace value:QuotedString {
      return { type: "comparison", operator, value };
    }
  / value:QuotedString {
      return { type: "comparison", operator: "equal", value };
    }

StringOperator
  = "CONTAINS" !IdentifierCharacter { return "contains"; }
  / "STARTS" Whitespace "WITH" !IdentifierCharacter { return "startsWith"; }
  / "ENDS" Whitespace "WITH" !IdentifierCharacter { return "endsWith"; }

Identifier
  = !ReservedKeyword name:$([a-z_] [a-z0-9_-]*) { return name; }

IdentifierCharacter
  = [a-zA-Z0-9_-]

ScalarValue
  = Quantity

Quantity
  = amount:Number unit:(Spacing unit:Unit { return unit; })?
    ValueBoundary {
      return { type: "quantity", amount, unit };
    }

Number
  = $([+-]? [0-9]+ ("." [0-9]+)?)

Unit
  = "GHz" / "MHz" / "kHz" / "Hz"
  / "TiB" / "GiB" / "MiB" / "KiB"
  / "TB" / "GB" / "MB" / "KB" / "B"
  / "Gbps" / "Mbps"

ValueBoundary
  = &(WhitespaceCharacter / ")" / !.)

QuotedString
  = raw:$('"' (Escape / [^"\\\u0000-\u001F])* '"') {
      return { type: "literal", value: JSON.parse(raw) };
    }

Escape
  = "\\" (["\\/bfnrt] / "u" HexDigit HexDigit HexDigit HexDigit)

HexDigit
  = [0-9a-fA-F]

ReservedKeyword
  = ("AND"i / "OR"i / "NOT"i / "NULL"i / "ABOVE"i / "BELOW"i
      / "AT"i / "CONTAINS"i / "STARTS"i / "ENDS"i)
    !IdentifierCharacter

Spacing
  = WhitespaceCharacter*

Whitespace
  = WhitespaceCharacter+

WhitespaceCharacter
  = [ \t\r\n]
