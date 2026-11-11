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
}

Query
  = Spacing expression:Expression? Spacing !. {
      return { type: "query", expression };
    }

Expression
  = OrExpression

OrExpression
  = head:AndExpression tail:(
      Whitespace "OR"i !IdentifierCharacter Whitespace right:AndExpression {
        return right;
      }
    )* {
      return combine("or", head, tail);
    }

AndExpression
  = head:UnaryExpression tail:(
      Whitespace right:UnaryExpression { return right; }
    )* {
      return combine("and", head, tail);
    }

UnaryExpression
  = operators:NegationOperator* expression:Primary {
      return negate(operators, expression);
    }

NegationOperator
  = "NOT"i !IdentifierCharacter Whitespace

Primary
  = Filter
  / Group
  / FuzzyText

Group
  = "(" Spacing expression:Expression Spacing ")" {
      return { type: "group", expression };
    }

// Value scope constrains one value; property scope constrains one object/item.
// Separate occurrences of a collection filter may match different items.
Filter
  = name:Identifier "(" Spacing content:FilterContent Spacing ")" {
      return { type: "filter", name: name.toLowerCase(), ...content };
    }

FilterContent
  = expression:PropertyOrExpression {
      return { scope: "properties", expression };
    }
  / expression:ValueOrExpression {
      return { scope: "value", expression };
    }

PropertyOrExpression
  = head:PropertyAndExpression tail:(
      Whitespace "OR"i !IdentifierCharacter Whitespace
      right:PropertyAndExpression { return right; }
    )* {
      return combine("or", head, tail);
    }

PropertyAndExpression
  = head:PropertyUnaryExpression tail:(
      Whitespace right:PropertyUnaryExpression { return right; }
    )* {
      return combine("and", head, tail);
    }

PropertyUnaryExpression
  = operators:NegationOperator* expression:PropertyPrimary {
      return negate(operators, expression);
    }

PropertyPrimary
  = Filter
  / "(" Spacing expression:PropertyOrExpression Spacing ")" {
      return { type: "group", expression };
    }

ValueOrExpression
  = head:ValueAndExpression tail:(
      Whitespace "OR"i !IdentifierCharacter Whitespace
      right:ValueAndExpression { return right; }
    )* {
      return combine("or", head, tail);
    }

ValueAndExpression
  = head:ValueUnaryExpression tail:(
      Whitespace "AND"i !IdentifierCharacter Whitespace
      right:ValueUnaryExpression {
        return right;
      }
    )* {
      return combine("and", head, tail);
    }

ValueUnaryExpression
  = operators:NegationOperator* expression:ValuePrimary {
      return negate(operators, expression);
    }

ValuePrimary
  = "(" Spacing expression:ValueOrExpression Spacing ")" {
      return { type: "group", expression };
    }
  / ValueComparison

ValueComparison
  = operator:NumericOperator Whitespace value:Quantity {
      return { type: "comparison", operator, value };
    }
  / operator:StringOperator Whitespace value:QuotedString {
      return { type: "comparison", operator, value };
    }
  / value:ScalarValue {
      return { type: "comparison", operator: "equal", value };
    }

NumericOperator
  = "ABOVE"i !IdentifierCharacter { return "above"; }
  / "BELOW"i !IdentifierCharacter { return "below"; }
  / "AT"i Whitespace "LEAST"i !IdentifierCharacter { return "atLeast"; }
  / "AT"i Whitespace "MOST"i !IdentifierCharacter { return "atMost"; }

StringOperator
  = "CONTAINS"i !IdentifierCharacter { return "contains"; }
  / "STARTS"i Whitespace "WITH"i !IdentifierCharacter { return "startsWith"; }
  / "ENDS"i Whitespace "WITH"i !IdentifierCharacter { return "endsWith"; }

Identifier
  = !ReservedKeyword name:$([a-zA-Z_] IdentifierCharacter*) { return name; }

IdentifierCharacter
  = [a-zA-Z0-9_-]

ScalarValue
  = QuotedString
  / Quantity
  / "NULL"i !IdentifierCharacter { return { type: "null" }; }

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
      return { type: "literal", value: JSON.parse(raw), quoted: true };
    }

Escape
  = "\\" (["\\/bfnrt] / "u" HexDigit HexDigit HexDigit HexDigit)

HexDigit
  = [0-9a-fA-F]

ReservedKeyword
  = ("AND"i / "OR"i / "NOT"i / "NULL"i / "ABOVE"i / "BELOW"i
      / "AT"i / "CONTAINS"i / "STARTS"i / "ENDS"i)
    !IdentifierCharacter

FuzzyText
  = value:QuotedString {
      return { type: "fuzzy", value: value.value };
    }

Spacing
  = WhitespaceCharacter*

Whitespace
  = WhitespaceCharacter+

WhitespaceCharacter
  = [ \t\r\n]
