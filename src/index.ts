import { Stream } from "xstream";

function moveElement<TElement>(
  arr: TElement[],
  fromIndex: number,
  toIndex: number
) {
  var element = arr[fromIndex];
  arr.splice(fromIndex, 1);
  arr.splice(toIndex, 0, element);
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
        let oldStartIndex = 0;
        let oldEndIndex = child.currentSNodes.length - 1;
        let newStartIndex = 0;
        const elementModelArray = child.getElementModelArray(model);
        let newEndIndex = elementModelArray.length - 1;

        while (oldStartIndex <= oldEndIndex && newStartIndex <= newEndIndex) {
          const oldStartRenderedSNode = child.currentSNodes[oldStartIndex];
          const oldStartSNode = child.currentSNodes[oldStartIndex].sNode;
          const oldStartKey = oldStartRenderedSNode.key;
          const newStartModel = elementModelArray[newStartIndex];
          const newStartKey = child.getKey(newStartModel);

          if (oldStartKey === newStartKey) {
            oldStartSNode.patch(newStartModel);
            oldStartIndex += 1;
            newStartIndex += 1;
            continue;
          }

          const oldEndRenderedSNode = child.currentSNodes[oldEndIndex];
          const oldEndSNode = child.currentSNodes[oldEndIndex].sNode;
          const oldEndKey = oldEndRenderedSNode.key;
          const newEndModel = elementModelArray[newEndIndex];
          const newEndKey = child.getKey(newEndModel);

          if (oldEndKey === newEndKey) {
            oldEndSNode.patch(newEndModel);
            oldEndIndex -= 1;
            newEndIndex -= 1;
            continue;
          }

          if (oldStartKey === newEndKey) {
            // Element moved right
            oldStartSNode.patch(newEndModel);
            this.node.insertBefore(
              oldStartSNode.node,
              oldEndSNode.node.nextSibling
            );
            moveElement(child.currentSNodes, oldStartIndex, oldEndIndex);
            oldStartIndex += 1;
            newEndIndex -= 1;
            continue;
          }

          if (oldEndIndex === newStartIndex) {
            // Element moved left
            oldEndSNode.patch(newStartModel);
            this.node.insertBefore(oldEndSNode.node, oldStartSNode.node);
            moveElement(child.currentSNodes, oldEndIndex, oldStartIndex);
            oldEndIndex -= 1;
            newStartIndex += 1;
            continue;
          }

          const indexInOld = findIndexInOld(
            child.currentSNodes,
            newStartKey,
            oldStartIndex,
            oldEndIndex
          );

          if (indexInOld === null) {
            // New element
            const element = new EachRenderedSNode(
              newStartKey,
              child.createElement()
            );
            element.sNode.patch(newStartModel);
            child.currentSNodes.push(element);
            this.node.insertBefore(element.sNode.node, oldStartSNode.node);
            newStartIndex += 1;
            continue;
          }

          // if (sameVnode(oldEndVnode, newStartVnode)) { // Vnode moved left
          //   patchVnode(oldEndVnode, newStartVnode, insertedVnodeQueue);
          //   api.insertBefore(parentElm, oldEndVnode.elm!, oldStartVnode.elm!);
          //   oldEndVnode = oldCh[--oldEndIdx];
          //   newStartVnode = newCh[++newStartIdx];
          // } else {
          //   if (oldKeyToIdx === undefined) {
          //     oldKeyToIdx = createKeyToOldIdx(oldCh, oldStartIdx, oldEndIdx);
          //   }
          //   idxInOld = oldKeyToIdx[newStartVnode.key as string];
          //   if (isUndef(idxInOld)) { // New element
          //     api.insertBefore(parentElm, createElm(newStartVnode, insertedVnodeQueue), oldStartVnode.elm!);
          //     newStartVnode = newCh[++newStartIdx];
          //   } else {
          //     elmToMove = oldCh[idxInOld];
          //     if (elmToMove.sel !== newStartVnode.sel) {
          //       api.insertBefore(parentElm, createElm(newStartVnode, insertedVnodeQueue), oldStartVnode.elm!);
          //     } else {
          //       patchVnode(elmToMove, newStartVnode, insertedVnodeQueue);
          //       oldCh[idxInOld] = undefined as any;
          //       api.insertBefore(parentElm, elmToMove.elm!, oldStartVnode.elm!);
          //     }
          //     newStartVnode = newCh[++newStartIdx];
          //   }
          // }
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

function findIndexInOld(
  children: EachRenderedSNode<unknown>[],
  key: string,
  beginIndex: number,
  endIndex: number
): number | null {
  for (let i = beginIndex; i <= endIndex; i += 1) {
    if (children[i].key === key) {
      return i;
    }
  }

  return null;
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
