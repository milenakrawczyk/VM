import React from "react";

const ReactKey = "$$typeof";
const isReactObject = (o) => typeof o === "object" && !!o[ReactKey];
const StakeKey = "state";

export default class VM {
  constructor(near, gkey) {
    this.near = near;
    this.gkey = gkey;
    this.gIndex = 0;
  }

  requireIdentifier(id) {
    if (id.type !== "Identifier") {
      throw new Error("Non identifier: " + id.type);
    }
    return id.name;
  }

  requireJSXIdentifier(id) {
    if (id.type !== "JSXIdentifier") {
      throw new Error("Non JSXIdentifier: " + id.type);
    }
    return id.name;
  }

  async socialGetr(key) {
    let data = await this.near.contract.get({
      keys: [`${key}/**`],
    });
    console.log(data);
    key.split("/").forEach((part) => {
      data = data?.[part];
    });
    return data;
  }

  async execCode(code) {
    console.log("Executing code:", code?.type);
    const res = await this.execCodeInternal(code);
    console.log(code?.type, res);
    return res;
  }

  async renderElement(code) {
    const element = this.requireJSXIdentifier(code.openingElement.name);
    const attributes = {};
    for (let i = 0; i < code.openingElement.attributes.length; i++) {
      const attribute = code.openingElement.attributes[i];
      if (attribute.type !== "JSXAttribute") {
        throw new Error("Non JSXAttribute: " + attribute.type);
      }
      const name = this.requireJSXIdentifier(attribute.name);

      if (
        name === "value" &&
        element === "input" &&
        attribute.value.type === "JSXExpressionContainer"
      ) {
        const [obj, key] = await this.resolveMemberExpression(
          attribute.value.expression,
          {
            requireState: true,
          }
        );
        attributes.value = obj?.[key];
        attributes.onChange = async (e) => {
          e.preventDefault();
          const value = e.target.value;
          console.log(this.state.state, obj, key, value);

          obj[key] = value;
          this.setReactState(JSON.parse(JSON.stringify(this.state.state)));
          return false;
        };
      } else {
        attributes[name] = await this.execCode(attribute.value);
      }
    }
    attributes.key = `${this.gkey}-${this.gIndex++}`;
    const children = [];
    for (let i = 0; i < code.children.length; i++) {
      children.push(await this.execCode(code.children[i]));
    }
    if (element === "div") {
      return <div {...attributes}>{children}</div>;
    } else if (element === "img") {
      return <img {...attributes} alt={attributes.alt ?? "not defined"} />;
    } else if (element === "br") {
      return <br />;
    } else if (element === "span") {
      return <span {...attributes}>{children}</span>;
    } else if (element === "pre") {
      return <pre {...attributes}>{children}</pre>;
    } else if (element === "input") {
      return <input {...attributes} />;
    } else {
      throw new Error("Unsupported element: " + element);
    }
  }

  async resolveKey(code, computed) {
    const key =
      !computed && code.type === "Identifier"
        ? code.name
        : await this.execCode(code);
    if (key === ReactKey) {
      throw new Error(`${ReactKey} can't be used`);
    }
    return key;
  }

  async callFunction(callee, args) {
    if (callee === "socialGetr") {
      if (args.length < 1) {
        throw new Error("Missing argument 'keys' for socialGetr");
      }
      return await this.socialGetr(args[0]);
    } else if (callee === "stringify") {
      if (args.length < 1) {
        throw new Error("Missing argument 'value' for stringify");
      }
      return JSON.stringify(args[0], undefined, 2);
    } else if (callee === "initState") {
      if (args.length < 1) {
        throw new Error("Missing argument 'initialState' for initState");
      }
      if (typeof args[0] !== "object") {
        throw new Error();
      }
      if (this.state.state !== undefined) {
        return null;
      }
      this.setReactState(JSON.parse(JSON.stringify(args[0])));
      this.setNeedRefresh(new Date().getTime());
      throw new Error("initializing the state");
    } else {
      throw new Error("Unknown callee method '" + callee + "'");
    }
  }

  /// Resolves the underlying object and the key to modify.
  /// Should only be used by left hand expressions for assignments.
  /// Options:
  /// - requireState requires the top object key be `state`
  async resolveMemberExpression(code, options) {
    if (code.type === "Identifier") {
      if (code.name === ReactKey) {
        throw new Error(`${ReactKey} can't be used`);
      }
      if (options?.requireState) {
        if (code.name !== StakeKey) {
          throw new Error(`The top object should be ${StakeKey}`);
        }
      } else {
        if (code.name === StakeKey) {
          throw new Error(
            `State can't be modified directly. Use "initState" to initialize the state.`
          );
        }
      }
      return [this.state, code.name];
    } else if (code.type === "MemberExpression") {
      const [innerObj, key] = await this.resolveMemberExpression(
        code.object,
        options
      );
      const property = await this.resolveKey(code.property, code.computed);
      const obj = innerObj?.[key];
      if (isReactObject(obj)) {
        throw new Error("React objects shouldn't be modified");
      }
      return [obj, property];
    } else {
      throw new Error("Unsupported member type: '" + code.type + "'");
    }
  }

  async execCodeInternal(code) {
    if (!code) {
      return null;
    }
    const type = code?.type;
    if (type === "AssignmentExpression") {
      const [obj, key] = await this.resolveMemberExpression(code.left, true);
      const right = await this.execCode(code.right);

      if (code.operator === "=") {
        return (obj[key] = right);
      } else if (code.operator === "+=") {
        return (obj[key] += right);
      } else if (code.operator === "-=") {
        return (obj[key] -= right);
      } else if (code.operator === "*=") {
        return (obj[key] *= right);
      } else if (code.operator === "/=") {
        return (obj[key] /= right);
      } else {
        throw new Error(
          "Unknown AssignmentExpression operator '" + code.operator + "'"
        );
      }
    } else if (type === "MemberExpression") {
      const obj = await this.execCode(code.object);
      const key = await this.resolveKey(code.property, code.computed);
      return obj?.[key];
    } else if (type === "Identifier") {
      return this.state[code.name];
    } else if (type === "JSXExpressionContainer") {
      return await this.execCode(code.expression);
    } else if (type === "TemplateLiteral") {
      const quasis = [];
      for (let i = 0; i < code.quasis.length; i++) {
        const element = code.quasis[i];
        if (element.type !== "TemplateElement") {
          throw new Error("Unknown quasis type: " + element.type);
        }
        quasis.push(element.value.cooked);
        if (!element.tail) {
          quasis.push(await this.execCode(code.expressions[i]));
        }
      }
      return quasis.join("");
    } else if (type === "CallExpression") {
      const callee = this.requireIdentifier(code.callee);
      const args = [];
      for (let i = 0; i < code.arguments.length; i++) {
        args.push(await this.execCode(code.arguments[i]));
      }
      return await this.callFunction(callee, args);
    } else if (type === "Literal") {
      return code.value;
    } else if (type === "JSXElement") {
      return await this.renderElement(code);
    } else if (type === "JSXText") {
      return code.value;
    } else if (type === "JSXExpressionContainer") {
      return await this.execCode(code.expression);
    } else if (type === "BinaryExpression") {
      const left = await this.execCode(code.left);
      const right = await this.execCode(code.right);
      if (code.operator === "+") {
        return left + right;
      } else if (code.operator === "-") {
        return left - right;
      } else if (code.operator === "*") {
        return left * right;
      } else if (code.operator === "/") {
        return left * right;
      } else {
        throw new Error(
          "Unknown BinaryExpression operator '" + code.operator + "'"
        );
      }
    } else if (type === "UnaryExpression") {
      const argument = await this.execCode(code.argument);
      if (code.operator === "-") {
        return -argument;
      } else if (code.operator === "!") {
        return !argument;
      } else {
        throw new Error(
          "Unknown UnaryExpression operator '" + code.operator + "'"
        );
      }
    } else if (type === "LogicalExpression") {
      const left = await this.execCode(code.left);
      if (code.operator === "||") {
        return left || (await this.execCode(code.right));
      } else if (code.operator === "&&") {
        return left && (await this.execCode(code.right));
      } else if (code.operator === "??") {
        return left ?? (await this.execCode(code.right));
      } else {
        throw new Error(
          "Unknown LogicalExpression operator '" + code.operator + "'"
        );
      }
    } else if (type === "ConditionalExpression") {
      const test = await this.execCode(code.test);
      return test
        ? await this.execCode(code.consequent)
        : await this.execCode(code.alternate);
    } else if (type === "UpdateExpression") {
      const [obj, key] = await this.resolveMemberExpression(code.argument);
      if (code.operator === "++") {
        return code.prefix ? ++obj[key] : obj[key]++;
      } else if (code.operator === "--") {
        return code.prefix ? --obj[key] : obj[key]--;
      } else {
        throw new Error(
          "Unknown UpdateExpression operator '" + code.operator + "'"
        );
      }
    } else if (type === "ObjectExpression") {
      let object = {};
      for (let i = 0; i < code.properties.length; i++) {
        const property = code.properties[i];
        if (property.type !== "Property") {
          throw new Error("Unknown property type: " + property.type);
        }
        const key = await this.resolveKey(property.key, property.computed);
        object[key] = await this.execCode(property.value);
      }
      return object;
    } else if (type === "ArrayExpression") {
      let array = [];
      for (let i = 0; i < code.elements.length; i++) {
        array.push(await this.execCode(code.elements[i]));
      }
      return array;
    } else if (type === "JSXEmptyExpression") {
      return null;
    } else {
      throw new Error("Unknown expression type '" + type + "'");
    }
  }

  async renderCode(
    code,
    initialState,
    reactState,
    setReactState,
    setNeedRefresh
  ) {
    if (!code || code.type !== "Program") {
      throw new Error("Not a program");
    }
    this.state = JSON.parse(JSON.stringify(initialState));
    this.state.state = reactState;
    this.setReactState = setReactState;
    this.setNeedRefresh = setNeedRefresh;
    this.code = code;
    let lastExpression = null;
    const body = this.code.body;
    for (let i = 0; i < body.length; i++) {
      const token = body[i];
      if (token.type === "VariableDeclaration") {
        for (let j = 0; j < token.declarations.length; j++) {
          const declaration = token.declarations[j];
          if (declaration.type === "VariableDeclarator") {
            this.state[this.requireIdentifier(declaration.id)] =
              await this.execCode(declaration.init);
          }
        }
      } else if (token.type === "ReturnStatement") {
        lastExpression = await this.execCode(token.argument);
        break;
      } else if (token.type === "ExpressionStatement") {
        lastExpression = await this.execCode(token.expression);
      }
    }

    return isReactObject(lastExpression) ||
      typeof lastExpression === "string" ||
      typeof lastExpression === "number" ? (
      lastExpression
    ) : (
      <pre>{JSON.stringify(lastExpression, undefined, 2)}</pre>
    );
  }
}