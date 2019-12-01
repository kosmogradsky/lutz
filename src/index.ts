import { Stream } from "xstream";

function findIndexInOld<TElementModel>(
  children: (EachRenderedSNode<TElementModel> | undefined)[],
  key: string,
  beginIndex: number,
  endIndex: number
): number | undefined {
  for (let i = beginIndex; i <= endIndex; i += 1) {
    if (children[i]?.key === key) {
      return i;
    }
  }

  return undefined;
}

class DText<TModel> {
  node: Text = document.createTextNode("");

  constructor(private getContent: (model: TModel) => string) {}

  patch(model: TModel) {
    this.node.data = this.getContent(model);
  }
}

class SText {
  node: Text;

  constructor(private content: string) {
    this.node = document.createTextNode(this.content);
  }

  patch() {}
}

type ChildSNode<TModel> =
  | DElement<TModel>
  | DText<TModel>
  | SText
  | FromModel<TModel>
  | ForEach<TModel, unknown>;

class DElement<TModel> {
  private insertNodeQueue: Node[] = [];
  node: HTMLElement;

  constructor(
    tagName: keyof HTMLElementTagNameMap,
    private styles: DStyle<TModel>[],
    private children: ChildSNode<TModel>[]
  ) {
    this.node = document.createElement(tagName);
  }

  private insertQueuedNodes(before: Node | null) {
    while (this.insertNodeQueue.length > 0) {
      this.node.insertBefore(this.insertNodeQueue.shift()!, before);
    }
  }

  patch(model: TModel) {
    for (const style of this.styles) {
      this.node.style[style.propertyName] = style.getValue(model);
    }

    for (const child of this.children) {
      if (
        child instanceof DText ||
        child instanceof SText ||
        child instanceof DElement
      ) {
        child.patch(model);

        if (child.node.parentNode === null) {
          this.node.appendChild(child.node);
        }

        this.insertQueuedNodes(child.node);
      } else if (child instanceof FromModel) {
        const sNode = child.getSNode(model);

        if (sNode === null) {
          child.currentSNode?.node.remove();
          child.currentSNode = sNode;
        } else if (child.currentSNode === sNode) {
          child.currentSNode.patch(model);
        } else {
          child.currentSNode?.node.remove();
          child.currentSNode = sNode;
          child.currentSNode.patch(model);
          this.insertNodeQueue.push(child.currentSNode.node);
        }
      } else {
        const currentSNodes: (EachRenderedSNode<unknown> | undefined)[] =
          child.currentSNodes;
        let oldStartIndex = 0;
        let oldEndIndex = child.currentSNodes.length - 1;
        let newStartIndex = 0;
        const elementModelArray = child.getElementModelArray(model);
        let newEndIndex = elementModelArray.length - 1;
        const currentSNodesMap: Map<
          string,
          EachRenderedSNode<unknown>
        > = new Map();
        for (const node of child.currentSNodes) {
          currentSNodesMap.set(node.key, node);
        }
        const nextSNodes: EachRenderedSNode<unknown>[] = [];
        for (const elementModel of elementModelArray) {
          const elementKey = child.getKey(elementModel);
          const elementInOld = currentSNodesMap.get(elementKey);

          if (elementInOld) {
            elementInOld.sNode.patch(elementModel);
            nextSNodes.push(elementInOld);
          } else {
            const nextElement = new EachRenderedSNode(
              elementKey,
              child.createElement()
            );
            nextElement.sNode.patch(elementModel);
            nextSNodes.push(nextElement);
          }
        }

        while (oldStartIndex <= oldEndIndex && newStartIndex <= newEndIndex) {
          const oldStartRenderedSNode = currentSNodes[oldStartIndex];

          if (oldStartRenderedSNode === undefined) {
            oldStartIndex += 1;
            continue;
          }

          const oldStartSNode = oldStartRenderedSNode.sNode;
          const oldStartKey = oldStartRenderedSNode.key;
          const newStartRenderedSNode = nextSNodes[newStartIndex];
          const newStartSNode = nextSNodes[newStartIndex].sNode;
          const newStartKey = newStartRenderedSNode.key;

          if (oldStartKey === newStartKey) {
            oldStartIndex += 1;
            newStartIndex += 1;
            continue;
          }

          const oldEndRenderedSNode = currentSNodes[oldEndIndex];

          if (oldEndRenderedSNode === undefined) {
            oldStartIndex += 1;
            continue;
          }

          const oldEndSNode = oldEndRenderedSNode.sNode;
          const oldEndKey = oldEndRenderedSNode.key;
          const newEndRenderedSNode = nextSNodes[newEndIndex];
          const newEndKey = newEndRenderedSNode.key;

          if (oldEndKey === newEndKey) {
            oldEndIndex -= 1;
            newEndIndex -= 1;
            continue;
          }

          if (oldStartKey === newEndKey) {
            // Element moved right
            this.node.insertBefore(
              oldStartSNode.node,
              oldEndSNode.node.nextSibling
            );
            oldStartIndex += 1;
            newEndIndex -= 1;
            continue;
          }

          if (oldEndIndex === newStartIndex) {
            // Element moved left
            this.node.insertBefore(oldEndSNode.node, oldStartSNode.node);
            oldEndIndex -= 1;
            newStartIndex += 1;
            continue;
          }

          const indexInOld = findIndexInOld(
            currentSNodes,
            newStartKey,
            oldStartIndex,
            oldEndIndex
          );

          if (indexInOld === undefined) {
            // New element
            this.node.insertBefore(newStartSNode.node, oldStartSNode.node);
            newStartIndex += 1;
            continue;
          }

          const sNodeToMove = currentSNodes[indexInOld]!.sNode;
          currentSNodes[indexInOld] = undefined;
          this.node.insertBefore(sNodeToMove.node, oldStartSNode.node);
        }
      }
    }

    this.insertQueuedNodes(null);
  }
}

class DStyle<TModel> {
  constructor(
    readonly propertyName: keyof Omit<
      CSSStyleDeclaration,
      "length" | "parentRule"
    >,
    readonly getValue: (model: TModel) => string
  ) {}
}

type ConditionalSNode<TModel> = DElement<TModel> | DText<TModel> | SText;

class FromModel<TModel> {
  currentSNode: ConditionalSNode<TModel> | null = null;

  constructor(
    readonly getSNode: (model: TModel) => ConditionalSNode<TModel> | null
  ) {}
}

type EachSNode<TModel> = DElement<TModel> | DText<TModel> | SText;

class EachRenderedSNode<TModel> {
  constructor(readonly key: string, readonly sNode: EachSNode<TModel>) {}
}

class ForEach<TModel, TElementModel> {
  currentSNodes: EachRenderedSNode<TElementModel>[] = [];

  constructor(
    readonly getElementModelArray: (model: TModel) => TElementModel[],
    readonly getKey: (model: TElementModel) => string,
    readonly createElement: () => EachSNode<TElementModel>
  ) {}
}

const lessThanDeclaration = new DElement<{ count: number }>(
  "div",
  [new DStyle("paddingLeft", ({ count }) => count * 10 + "px")],
  [
    new SText("static "),
    new DText((model: { count: number }) => "less than 20: " + model.count)
  ]
);

const moreThanDeclaration = new DElement<{ count: number }>(
  "div",
  [new DStyle("paddingTop", ({ count }) => count * 10 + "px")],
  [
    new SText("static "),
    new DText((model: { count: number }) => "more than 20: " + model.count)
  ]
);

const getView = (model: { count: number }) => {
  if (model.count < 5) {
    return lessThanDeclaration;
  } else {
    return moreThanDeclaration;
  }
};

const rootElement = new DElement<{ count: number }>(
  "div",
  [],
  [
    new DElement("span", [], [new SText("before")]),
    new FromModel(getView),
    new SText("after")
  ]
);

document.body.appendChild(rootElement.node);

Stream.periodic(1000)
  .map(count => ({ count }))
  .subscribe({
    next(model) {
      rootElement.patch(model);
    }
  });
