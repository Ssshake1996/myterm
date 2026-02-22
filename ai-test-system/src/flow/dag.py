"""
DAG (Directed Acyclic Graph) implementation for flow execution.
"""
from collections import defaultdict, deque
from typing import Dict, List, Set
from ..core.exceptions import CycleDetectedError


class DAG:
    """
    Directed Acyclic Graph implementation for representing flows.
    """

    def __init__(self):
        self.graph: Dict[str, List[str]] = defaultdict(list)  # adjacency list
        self.nodes: Set[str] = set()  # all nodes in the graph

    def add_node(self, node_id: str) -> None:
        """
        Add a node to the DAG.
        """
        self.nodes.add(node_id)
        if node_id not in self.graph:
            self.graph[node_id] = []

    def add_edge(self, from_node: str, to_node: str) -> None:
        """
        Add a directed edge from from_node to to_node.
        """
        # Ensure both nodes exist
        self.add_node(from_node)
        self.add_node(to_node)

        # Add the edge
        self.graph[from_node].append(to_node)

    def remove_edge(self, from_node: str, to_node: str) -> None:
        """
        Remove a directed edge from from_node to to_node.
        """
        if from_node in self.graph and to_node in self.graph[from_node]:
            self.graph[from_node].remove(to_node)

    def get_neighbors(self, node: str) -> List[str]:
        """
        Get all neighbors (successors) of a node.
        """
        return self.graph.get(node, [])

    def get_predecessors(self, node: str) -> List[str]:
        """
        Get all predecessors of a node.
        """
        predecessors = []
        for src, dest_list in self.graph.items():
            if node in dest_list:
                predecessors.append(src)
        return predecessors

    def is_acyclic(self) -> bool:
        """
        Check if the graph is acyclic using DFS.
        Returns True if acyclic, False otherwise.
        """
        visited = set()
        rec_stack = set()

        for node in self.nodes:
            if node not in visited:
                if self._has_cycle_dfs(node, visited, rec_stack):
                    return False
        return True

    def _has_cycle_dfs(self, node: str, visited: Set[str], rec_stack: Set[str]) -> bool:
        """
        Helper method for detecting cycles using DFS.
        """
        visited.add(node)
        rec_stack.add(node)

        # Visit all neighbors
        for neighbor in self.graph[node]:
            if neighbor not in visited:
                if self._has_cycle_dfs(neighbor, visited, rec_stack):
                    return True
            elif neighbor in rec_stack:
                # Found back edge, which indicates a cycle
                return True

        # Remove the node from recursion stack
        rec_stack.remove(node)
        return False

    def topological_sort(self) -> List[str]:
        """
        Perform topological sort on the DAG.
        Returns a list of nodes in topological order.
        Raises CycleDetectedError if the graph has a cycle.
        """
        if not self.is_acyclic():
            raise CycleDetectedError("Cannot perform topological sort on a cyclic graph")

        # Calculate in-degrees of all vertices
        in_degree = {node: 0 for node in self.nodes}

        for node in self.nodes:
            for neighbor in self.graph[node]:
                in_degree[neighbor] += 1

        # Create a queue and enqueue all vertices with in-degree 0
        queue = deque([node for node in self.nodes if in_degree[node] == 0])
        top_order = []

        while queue:
            # Extract front of queue and add it to topological order
            u = queue.popleft()
            top_order.append(u)

            # Iterate through all neighboring nodes of dequeued node u
            # and decrease their in-degree by 1
            for neighbor in self.graph[u]:
                in_degree[neighbor] -= 1
                # If in-degree becomes 0, add it to queue
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        return top_order

    def get_roots(self) -> List[str]:
        """
        Get all root nodes (nodes with no incoming edges).
        """
        roots = []
        for node in self.nodes:
            if not self.get_predecessors(node):
                roots.append(node)
        return roots

    def get_leaves(self) -> List[str]:
        """
        Get all leaf nodes (nodes with no outgoing edges).
        """
        leaves = []
        for node in self.nodes:
            if not self.graph[node]:  # no outgoing edges
                leaves.append(node)
        return leaves

    def has_path(self, from_node: str, to_node: str) -> bool:
        """
        Check if there is a path from from_node to to_node.
        """
        if from_node not in self.nodes or to_node not in self.nodes:
            return False

        visited = set()
        queue = deque([from_node])
        visited.add(from_node)

        while queue:
            current = queue.popleft()
            if current == to_node:
                return True

            for neighbor in self.graph[current]:
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)

        return False

    def get_subgraph(self, nodes: List[str]) -> 'DAG':
        """
        Get a subgraph containing only the specified nodes and their relationships.
        """
        subgraph = DAG()

        # Add nodes
        for node in nodes:
            if node in self.nodes:
                subgraph.add_node(node)

        # Add edges that connect nodes in the subgraph
        for node in nodes:
            if node in self.graph:
                for neighbor in self.graph[node]:
                    if neighbor in nodes:
                        subgraph.add_edge(node, neighbor)

        return subgraph