# Prefer `type` Over `interface` in TypeScript

## Status

accepted

## Decision

Use `type` in TypeScript and avoid using `interface` unless required by third-party libraries or APIs.

## Context

- **Flexibility**: `type` allows the definition of unions and intersections, which `interface` cannot express. This provides more versatility in handling complex type structures. For example:

  ```typescript
  type Status = 'success' | 'error' | 'pending'; // Possible with type
  interface Status {} // Not possible with interface
  ```

- **Ease of Use**: Using `type` is less verbose for advanced features, such as applying `Readonly`. Compare the following:

  ```typescript
  type ReadonlyPage = Readonly<{
    id: string;
    title: string;
    content: string;
    createdOn: Date;
    updatedOn: Date;
  }>;

  interface ReadonlyPage {
    readonly id: string;
    readonly title: string;
    readonly content: string;
    readonly createdOn: Date;
    readonly updatedOn: Date;
  }
  ```

The `type` approach avoids redundancy and is easier to read.

- **Feature Parity**: While `type` can do everything `interface` can (e.g., object shapes, function signatures, etc.), the reverse is not true. For example, `interface` cannot define union types. This makes `type` more suitable for varied use cases.

- **Avoiding Over-Engineering**: Features like declaration merging in `interface` can lead to unintended complexities. See [More On Over-Engineering](#more-on-over-engineering) for examples.

- **Consistency and Clarity**: Adopting `type` exclusively ensures consistency across the codebase, reducing cognitive load and making it easier for new developers to onboard.

- **Compatibility with [zod](https://zod.dev)**: We should be validating many of our types at runtime. We use the zod lib for that, and it uses / produces `type`, not `interface`.

## Consequences

- **Benefits**:
  - Simplifies development by unifying the approach to defining types.
  - Reduces verbosity and improves code clarity, particularly for complex types.
  - Minimizes risks of over-engineering associated with features like declaration merging.
  - Enables more expressive type definitions, such as unions and intersections.

- **Drawbacks**:
  - `type` does not support declaration merging. However, declaration merging is often a source of confusion and over-engineering, so its absence is considered a net positive.

- **Future Considerations**:
  - This decision may be revisited if TypeScript introduces enhancements to `interface` or deprecates features in `type`.

---

## More On Over-Engineering

Here are some examples of over-engineering associated with TypeScript interfaces, particularly when compared to the simpler, more functional approach often favored in modern transactional web and mobile applications:

### Excessive Declaration Merging

Declaration merging allows multiple interfaces with the same name to be combined into one. While this can be helpful for extending third-party types, it can lead to confusion when overused. For instance:

```typescript
interface User {
  id: string;
}

interface User {
  name: string;
}

const user: User = { id: '123', name: 'Alice' }; // Merged interface
```

- **Why it's over-engineered**: This feature can result in unexpected behaviors, where developers are unaware of all the properties in an interface due to merging across files or modules. This is especially problematic in functional programming, where simplicity and immutability are valued.

### Creating Deeply Nested Structures

Object-oriented developers sometimes use interfaces to model highly nested structures that mimic database schemas or domain models:

```typescript
interface Order {
  id: string;
  customer: {
    id: string;
    name: string;
    address: {
      city: string;
      state: string;
      zip: string;
    };
  };
}
```

- **Why it's over-engineered**: While it may look organized, deeply nested structures complicate immutability and data manipulation. Functional programming encourages flat structures and transformation pipelines, which are more maintainable for web and mobile apps.

### Using Interfaces for Every Single Object

Some teams follow strict practices of defining interfaces for every object, even those used internally or with a short lifespan:

```typescript
interface Point {
  x: number;
  y: number;
}

const point: Point = { x: 10, y: 20 };
```

- **Why it's over-engineered**: For many cases, inline type annotations (`{ x: number; y: number }`) or type aliases are simpler and sufficient. Creating interfaces for transient structures adds unnecessary cognitive load.

### Inflexibility in Composition

Interfaces often lead to rigid inheritance hierarchies, mimicking OOP patterns:

```typescript
interface Shape {
  area(): number;
}

interface Circle extends Shape {
  radius: number;
}

interface Rectangle extends Shape {
  width: number;
  height: number;
}
```

- **Why it's over-engineered**: Functional patterns like discriminated unions or higher-order functions handle polymorphism more effectively and concisely:

```typescript
type Shape =
  | { kind: 'circle'; radius: number }
  | { kind: 'rectangle'; width: number; height: number };

function area(shape: Shape): number {
  switch (shape.kind) {
    case 'circle': return Math.PI * shape.radius ** 2;
    case 'rectangle': return shape.width * shape.height;
  }
}
```

_see [zod's documenation on discriminated unions](https://zod.dev/?id=discriminated-unions) for more information. The discriminator in the example above is `kind`. Chances are, you've interacted with a discriminated union before. `Promise.allSettled` produces a discriminated union in which `success` is the discriminator, and the existence of `error` or `data` depends on the value of `success`. `addEventListener` accepts a discriminated union in the `event` arg, with which you can conditionally execute code with `event.type === "click"`, or the like._

### Attempting to Mirror Class-Based OOP

Interfaces are often misused to replicate class-based inheritance in an effort to enforce shared behavior across types:

```typescript
interface Animal {
  eat(): void;
}

class Dog implements Animal {
  eat() {
    console.log("Dog is eating");
  }
}

class Cat implements Animal {
  eat() {
    console.log("Cat is eating");
  }
}
```

- **Why it's over-engineered**: Functional programming relies on composition and pure functions, avoiding the overhead of inheritance trees. For instance:

```typescript
type Animal = { eat: () => void };

const dog: Animal = { eat: () => console.log("Dog is eating") };
const cat: Animal = { eat: () => console.log("Cat is eating") };
```

### Redundant Extension of Third-Party Types

Developers sometimes create interfaces that extend third-party library types, duplicating functionality that could be directly imported and used:

```typescript
interface ExtendedButton extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant: 'primary' | 'secondary';
}
```

- **Why it's over-engineered**: Instead of extending the library, developers can use utility types (e.g., `Pick`, `Omit`) or inline types to achieve the same effect with less abstraction.

### Summary of Over-Engineering Risks

- **Complexity**: Interfaces encourage practices like inheritance and deep nesting, which can complicate functional workflows.
- **Rigidity**: Over-reliance on interfaces can lead to brittle systems that are harder to refactor or extend.
- **Maintenance Overhead**: Interface-heavy designs can require more effort to update, debug, and maintain.

Focusing on simple, composable patterns with `type`, unions, and functions aligns better with functional programming principles and the dynamic nature of modern web and mobile apps.
